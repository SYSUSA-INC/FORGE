"use server";

import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import {
  proposalTemplates,
  type ProposalTemplateKind,
  type TemplateSectionSeed,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg, requireOrgAdmin } from "@/lib/auth-helpers";
import { getStorageProvider } from "@/lib/storage";
import { isLikelyDocx, scanDocxForVariables } from "@/lib/docx-template";
import { STARTER_TEMPLATES } from "@/lib/template-types";

const DOCX_MAX_BYTES = 25 * 1024 * 1024;

export type TemplateRow = {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  archivedAt: string | null;
  sectionCount: number;
  brandPrimary: string;
  brandAccent: string;
  fontDisplay: string;
  fontBody: string;
  logoUrl: string;
  updatedAt: string;
};

export async function listTemplatesAction(): Promise<TemplateRow[]> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const rows = await db
    .select({
      id: proposalTemplates.id,
      name: proposalTemplates.name,
      description: proposalTemplates.description,
      isDefault: proposalTemplates.isDefault,
      archivedAt: proposalTemplates.archivedAt,
      sectionSeed: proposalTemplates.sectionSeed,
      brandPrimary: proposalTemplates.brandPrimary,
      brandAccent: proposalTemplates.brandAccent,
      fontDisplay: proposalTemplates.fontDisplay,
      fontBody: proposalTemplates.fontBody,
      logoUrl: proposalTemplates.logoUrl,
      updatedAt: proposalTemplates.updatedAt,
    })
    .from(proposalTemplates)
    .where(eq(proposalTemplates.organizationId, organizationId))
    .orderBy(desc(proposalTemplates.isDefault), asc(proposalTemplates.name));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    isDefault: r.isDefault,
    archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
    sectionCount: (r.sectionSeed as TemplateSectionSeed[] | null)?.length ?? 0,
    brandPrimary: r.brandPrimary,
    brandAccent: r.brandAccent,
    fontDisplay: r.fontDisplay,
    fontBody: r.fontBody,
    logoUrl: r.logoUrl,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function getDefaultTemplate(organizationId: string) {
  const [row] = await db
    .select({
      id: proposalTemplates.id,
      sectionSeed: proposalTemplates.sectionSeed,
    })
    .from(proposalTemplates)
    .where(
      and(
        eq(proposalTemplates.organizationId, organizationId),
        eq(proposalTemplates.isDefault, true),
        isNull(proposalTemplates.archivedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getTemplateForEditAction(id: string) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const [row] = await db
    .select()
    .from(proposalTemplates)
    .where(
      and(
        eq(proposalTemplates.id, id),
        eq(proposalTemplates.organizationId, organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createTemplateAction(input: {
  name: string;
  description?: string;
  starterIndex?: number;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Name is required." };

  const starter =
    typeof input.starterIndex === "number"
      ? STARTER_TEMPLATES[input.starterIndex] ?? STARTER_TEMPLATES[0]
      : STARTER_TEMPLATES[0];

  try {
    const [row] = await db
      .insert(proposalTemplates)
      .values({
        organizationId,
        name,
        description: input.description?.trim() ?? "",
        isDefault: false,
        // New templates default to docx — the user uploads a Word
        // template on the next screen. They can flip to legacy HTML/CSS
        // if they really want to.
        kind: "docx",
        sectionSeed: starter!.sectionSeed,
        // Keep the HTML starter content available so the legacy mode
        // is non-empty when the user flips back to it.
        coverHtml: starter!.coverHtml,
        headerHtml: starter!.headerHtml,
        footerHtml: starter!.footerHtml,
        pageCss: starter!.pageCss,
        brandPrimary: starter!.brandPrimary,
        brandAccent: starter!.brandAccent,
        fontDisplay: starter!.fontDisplay,
        fontBody: starter!.fontBody,
        logoUrl: starter!.logoUrl,
        createdByUserId: user.id,
      })
      .returning({ id: proposalTemplates.id });
    revalidatePath("/settings/templates");
    return { ok: true, id: row!.id };
  } catch (err) {
    console.error("[createTemplateAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Create failed.",
    };
  }
}

export async function createTemplateAndGoAction(input: {
  name: string;
  description?: string;
  starterIndex?: number;
}): Promise<void> {
  const res = await createTemplateAction(input);
  if (res.ok) redirect(`/settings/templates/${res.id}`);
  throw new Error(res.ok ? "unreachable" : res.error);
}

export async function updateTemplateAction(
  id: string,
  input: {
    name?: string;
    description?: string;
    coverHtml?: string;
    headerHtml?: string;
    footerHtml?: string;
    pageCss?: string;
    sectionSeed?: TemplateSectionSeed[];
    brandPrimary?: string;
    brandAccent?: string;
    fontDisplay?: string;
    fontBody?: string;
    logoUrl?: string;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  try {
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) update.name = input.name.trim();
    if (input.description !== undefined)
      update.description = input.description.trim();
    if (input.coverHtml !== undefined) update.coverHtml = input.coverHtml;
    if (input.headerHtml !== undefined) update.headerHtml = input.headerHtml;
    if (input.footerHtml !== undefined) update.footerHtml = input.footerHtml;
    if (input.pageCss !== undefined) update.pageCss = input.pageCss;
    if (input.sectionSeed !== undefined) update.sectionSeed = input.sectionSeed;
    if (input.brandPrimary !== undefined)
      update.brandPrimary = input.brandPrimary;
    if (input.brandAccent !== undefined) update.brandAccent = input.brandAccent;
    if (input.fontDisplay !== undefined) update.fontDisplay = input.fontDisplay;
    if (input.fontBody !== undefined) update.fontBody = input.fontBody;
    if (input.logoUrl !== undefined) update.logoUrl = input.logoUrl;

    await db
      .update(proposalTemplates)
      .set(update)
      .where(
        and(
          eq(proposalTemplates.id, id),
          eq(proposalTemplates.organizationId, organizationId),
        ),
      );
    revalidatePath("/settings/templates");
    revalidatePath(`/settings/templates/${id}`);
    return { ok: true };
  } catch (err) {
    console.error("[updateTemplateAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Update failed.",
    };
  }
}

export async function setDefaultTemplateAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  try {
    // Sequential updates per Neon-pgbouncer rule: clear existing default,
    // set new default. (Cannot use db.transaction.)
    await db
      .update(proposalTemplates)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(proposalTemplates.organizationId, organizationId),
          eq(proposalTemplates.isDefault, true),
        ),
      );
    await db
      .update(proposalTemplates)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(
        and(
          eq(proposalTemplates.id, id),
          eq(proposalTemplates.organizationId, organizationId),
        ),
      );
    revalidatePath("/settings/templates");
    return { ok: true };
  } catch (err) {
    console.error("[setDefaultTemplateAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to set default.",
    };
  }
}

export async function archiveTemplateAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  try {
    await db
      .update(proposalTemplates)
      .set({ archivedAt: new Date(), isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(proposalTemplates.id, id),
          eq(proposalTemplates.organizationId, organizationId),
        ),
      );
    revalidatePath("/settings/templates");
    return { ok: true };
  } catch (err) {
    console.error("[archiveTemplateAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Archive failed.",
    };
  }
}

export async function unarchiveTemplateAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  try {
    await db
      .update(proposalTemplates)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(proposalTemplates.id, id),
          eq(proposalTemplates.organizationId, organizationId),
        ),
      );
    revalidatePath("/settings/templates");
    return { ok: true };
  } catch (err) {
    console.error("[unarchiveTemplateAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unarchive failed.",
    };
  }
}

/**
 * Switch a template between html (legacy) and docx (preferred). Used
 * when a user wants to migrate a template they previously authored as
 * HTML/CSS over to a Word file.
 */
export async function setTemplateKindAction(
  id: string,
  kind: ProposalTemplateKind,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  await db
    .update(proposalTemplates)
    .set({ kind, updatedAt: new Date() })
    .where(
      and(
        eq(proposalTemplates.id, id),
        eq(proposalTemplates.organizationId, organizationId),
      ),
    );
  revalidatePath("/settings/templates");
  revalidatePath(`/settings/templates/${id}`);
  return { ok: true };
}

export type DocxUploadResult =
  | {
      ok: true;
      variables: string[];
      warnings: string[];
      fileName: string;
      fileSize: number;
    }
  | { ok: false; error: string };

/**
 * Upload a .docx as the source-of-truth for a template. We store the
 * bytes via the storage provider, scan for {placeholder} variables,
 * and surface any warnings (broken splits, no placeholders found).
 *
 * The actual rendering happens in Phase 12b — for now we just persist
 * the file + the detected variable list so the editor UI can show
 * the user which placeholders FORGE will substitute on render.
 */
export async function uploadTemplateDocxAction(
  templateId: string,
  formData: FormData,
): Promise<DocxUploadResult> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "Pick a Word file (.docx) to upload." };
  }
  if (file.size === 0) return { ok: false, error: "File is empty." };
  if (file.size > DOCX_MAX_BYTES) {
    return {
      ok: false,
      error: `Template is larger than ${DOCX_MAX_BYTES / 1024 / 1024} MB. Trim or compress before uploading.`,
    };
  }
  if (!isLikelyDocx(file.type, file.name)) {
    return {
      ok: false,
      error: "Only .docx (Word) templates are supported. Save as Word format and re-upload.",
    };
  }

  // Confirm the template exists in this org.
  const [tpl] = await db
    .select({ id: proposalTemplates.id })
    .from(proposalTemplates)
    .where(
      and(
        eq(proposalTemplates.id, templateId),
        eq(proposalTemplates.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!tpl) return { ok: false, error: "Template not found." };

  const bytes = new Uint8Array(await file.arrayBuffer());

  // Scan for placeholders BEFORE storing — if the file is corrupt,
  // we'd rather fail fast with a clear error.
  const scan = await scanDocxForVariables(bytes);

  // Persist bytes via the storage provider.
  const storage = getStorageProvider();
  const key = `org/${organizationId}/template/${templateId}/${file.name}`;
  let storagePath = "";
  try {
    const stored = await storage.put({
      key,
      bytes,
      contentType:
        file.type ||
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    storagePath = stored.storagePath;
  } catch (err) {
    console.error("[uploadTemplateDocx] storage", err);
    return {
      ok: false,
      error: "Saved scan results, but storing the file bytes failed. Try again.",
    };
  }

  await db
    .update(proposalTemplates)
    .set({
      kind: "docx",
      docxStoragePath: storagePath,
      docxFileName: file.name,
      docxFileSize: file.size,
      docxUploadedAt: new Date(),
      variablesDetected: scan.variables,
      updatedAt: new Date(),
    })
    .where(eq(proposalTemplates.id, templateId));

  revalidatePath("/settings/templates");
  revalidatePath(`/settings/templates/${templateId}`);

  return {
    ok: true,
    variables: scan.variables,
    warnings: scan.warnings,
    fileName: file.name,
    fileSize: file.size,
  };
}

/**
 * Remove the uploaded .docx for a template (e.g. user wants to switch
 * to a different file). Resets fields but leaves the kind alone so the
 * user stays in docx mode.
 */
export async function clearTemplateDocxAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  await db
    .update(proposalTemplates)
    .set({
      docxStoragePath: "",
      docxFileName: "",
      docxFileSize: 0,
      docxUploadedAt: null,
      variablesDetected: [],
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(proposalTemplates.id, id),
        eq(proposalTemplates.organizationId, organizationId),
      ),
    );
  revalidatePath("/settings/templates");
  revalidatePath(`/settings/templates/${id}`);
  return { ok: true };
}

export async function listActiveTemplatesForPickerAction(): Promise<
  { id: string; name: string; description: string; isDefault: boolean }[]
> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const rows = await db
    .select({
      id: proposalTemplates.id,
      name: proposalTemplates.name,
      description: proposalTemplates.description,
      isDefault: proposalTemplates.isDefault,
    })
    .from(proposalTemplates)
    .where(
      and(
        eq(proposalTemplates.organizationId, organizationId),
        isNull(proposalTemplates.archivedAt),
      ),
    )
    .orderBy(desc(proposalTemplates.isDefault), asc(proposalTemplates.name));
  return rows;
}
