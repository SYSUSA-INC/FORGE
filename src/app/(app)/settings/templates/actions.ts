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
import { recordAudit } from "@/lib/audit-log";
import { scanDocxForVariables } from "@/lib/docx-template";
import { claimUpload, failClaim, finishClaim, getVerifiedObject, releaseClaim, releaseStoredFile, releaseSupersededTemplateFiles } from "@/lib/uploads";
import { STARTER_TEMPLATES } from "@/lib/template-types";
import { templateAuthoringRefusal } from "@/lib/template-gate";
import { log } from "@/lib/log";

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
  const refusal = await templateAuthoringRefusal(organizationId);
  if (refusal) return { ok: false, error: refusal };

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
    await recordAudit({
      organizationId,
      actor: { userId: user.id, email: user.email },
      action: "template.create",
      resourceType: "template",
      resourceId: row!.id,
      metadata: { name: input.name },
    });
    revalidatePath("/settings/templates");
    return { ok: true, id: row!.id };
  } catch (err) {
    log.error("[createTemplateAction]", "error", { error: err });
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
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);
  const refusal = await templateAuthoringRefusal(organizationId);
  if (refusal) return { ok: false, error: refusal };

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
    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "template.update",
      resourceType: "template",
      resourceId: id,
      metadata: { fields: Object.keys(input) },
    });
    revalidatePath("/settings/templates");
    revalidatePath(`/settings/templates/${id}`);
    return { ok: true };
  } catch (err) {
    log.error("[updateTemplateAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Update failed.",
    };
  }
}

export async function setDefaultTemplateAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
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
    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "template.set_default",
      resourceType: "template",
      resourceId: id,
    });
    revalidatePath("/settings/templates");
    return { ok: true };
  } catch (err) {
    log.error("[setDefaultTemplateAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to set default.",
    };
  }
}

export async function archiveTemplateAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
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
    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "template.archive",
      resourceType: "template",
      resourceId: id,
    });
    revalidatePath("/settings/templates");
    return { ok: true };
  } catch (err) {
    log.error("[archiveTemplateAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Archive failed.",
    };
  }
}

export async function unarchiveTemplateAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
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
    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "template.unarchive",
      resourceType: "template",
      resourceId: id,
    });
    revalidatePath("/settings/templates");
    return { ok: true };
  } catch (err) {
    log.error("[unarchiveTemplateAction]", "error", { error: err });
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
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);
  const refusal = await templateAuthoringRefusal(organizationId);
  if (refusal) return { ok: false, error: refusal };

  await db
    .update(proposalTemplates)
    .set({ kind, updatedAt: new Date() })
    .where(
      and(
        eq(proposalTemplates.id, id),
        eq(proposalTemplates.organizationId, organizationId),
      ),
    );
  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "template.set_kind",
    resourceType: "template",
    resourceId: id,
    metadata: { kind },
  });
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * BL-STAB-2f — attach a .docx the browser uploaded straight to storage as
 * a template's source file (up to the policy's 50 MB, not a request's
 * ~4.5 MB), and scan it for {placeholder} variables. The claim names the
 * template, so a retry continues it and a file never moves to another
 * template; a file that can't be read as a .docx is refused and deleted;
 * the file it replaces is released (never the one just attached), and
 * only if no other change to the template landed meanwhile.
 */
export async function attachTemplateDocxFromUploadAction(
  templateId: string,
  uploadId: string,
): Promise<DocxUploadResult> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);
  const refusal = await templateAuthoringRefusal(organizationId);
  if (refusal) return { ok: false, error: refusal };
  if (typeof templateId !== "string" || !UUID.test(templateId)) return { ok: false, error: "Template not found." };

  const [tpl] = await db
    .select({
      docxStoragePath: proposalTemplates.docxStoragePath,
      docxFileName: proposalTemplates.docxFileName,
      docxFileSize: proposalTemplates.docxFileSize,
      variablesDetected: proposalTemplates.variablesDetected,
    })
    .from(proposalTemplates)
    .where(and(eq(proposalTemplates.id, templateId), eq(proposalTemplates.organizationId, organizationId)))
    .limit(1);
  if (!tpl) return { ok: false, error: "Template not found." };

  const claim = await claimUpload({
    organizationId,
    userId: actor.id,
    uploadId: String(uploadId ?? ""),
    resourceType: "proposal_template",
    resourceId: templateId,
  });
  if (!claim.ok) return { ok: false, error: claim.error };
  if ("alreadyClaimed" in claim) {
    // A repeat after the file was attached: answer with what the template holds.
    return { ok: true, variables: tpl.variablesDetected, warnings: [], fileName: tpl.docxFileName, fileSize: tpl.docxFileSize };
  }
  const file = claim.claim;
  const held = { organizationId, uploadId: file.uploadId, claimedAt: file.claimedAt };

  let read: Awaited<ReturnType<typeof getVerifiedObject>>;
  try {
    read = await getVerifiedObject({ organizationId, storagePath: file.storageKey });
  } catch (err) {
    log.warn("[attachTemplateDocxFromUploadAction]", "storage read failed", { error: err });
    await releaseClaim(held);
    return { ok: false, error: "File storage could not be reached just now. Try again in a minute." };
  }
  if (!read.ok) {
    await failClaim({ ...held, reason: "claim_failed", detail: "The stored file could not be read." });
    return { ok: false, error: "The uploaded file could not be read from storage; upload it again." };
  }
  const scan = await scanDocxForVariables(read.bytes);
  if (scan.unreadable) {
    await failClaim({ ...held, reason: "claim_failed", detail: scan.unreadable });
    return { ok: false, error: scan.unreadable };
  }

  // The file it replaces. A retry may find this upload's own file already attached.
  const previous = tpl.docxStoragePath;
  let updated: { id: string }[];
  try {
    updated = await db
      .update(proposalTemplates)
      .set({
        kind: "docx",
        docxStoragePath: file.storageKey,
        docxFileName: file.fileName,
        docxFileSize: file.size,
        docxUploadedAt: new Date(),
        variablesDetected: scan.variables,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(proposalTemplates.organizationId, organizationId),
          eq(proposalTemplates.id, templateId),
          eq(proposalTemplates.docxStoragePath, previous),
        ),
      )
      .returning({ id: proposalTemplates.id });
  } catch (err) {
    // The update may have landed with only its answer lost: then it is saved.
    const [now] = await db
      .select({ docxStoragePath: proposalTemplates.docxStoragePath })
      .from(proposalTemplates)
      .where(and(eq(proposalTemplates.id, templateId), eq(proposalTemplates.organizationId, organizationId)))
      .limit(1)
      .catch(() => []);
    if (now?.docxStoragePath !== file.storageKey) {
      log.error("[attachTemplateDocxFromUploadAction]", "template update failed", { error: err });
      await releaseClaim(held);
      return { ok: false, error: "Could not save the template; try again." };
    }
    log.warn("[attachTemplateDocxFromUploadAction]", "template update reported an error after it landed", { error: err });
    updated = [{ id: templateId }];
  }
  if (updated.length === 0) {
    // Another change to the file landed first (a second tab): this upload stays ready to try again.
    await releaseClaim(held);
    return { ok: false, error: "The template's file changed while this one was being saved. Reload the page and try again." };
  }
  // Released before the claim is finished: a filing that dies in between is finished by the sweep, which never sees the old file.
  const replaced = previous && previous !== file.storageKey ? await releaseStoredFile({ organizationId, storagePath: previous, reason: "replaced" }) : "skipped";
  // And anything an earlier attempt that died left filed on this template.
  await releaseSupersededTemplateFiles(organizationId, templateId);
  await finishClaim(held);

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "template.upload_docx",
    resourceType: "template",
    resourceId: templateId,
    metadata: {
      uploadId: file.uploadId,
      fileName: file.fileName,
      fileSize: file.size,
      variableCount: scan.variables.length,
      replaced: replaced !== "skipped",
    },
  });

  revalidatePath("/settings/templates");
  revalidatePath(`/settings/templates/${templateId}`);
  return { ok: true, variables: scan.variables, warnings: scan.warnings, fileName: file.fileName, fileSize: file.size };
}

/**
 * Remove the uploaded .docx for a template (e.g. user wants to switch
 * to a different file). Resets fields but leaves the kind alone so the
 * user stays in docx mode. BL-STAB-2f — the file is released (the jobs
 * cron deletes it), and only if no other change to it landed meanwhile.
 */
export async function clearTemplateDocxAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);
  const refusal = await templateAuthoringRefusal(organizationId);
  if (refusal) return { ok: false, error: refusal };

  const [tpl] = await db
    .select({ docxStoragePath: proposalTemplates.docxStoragePath })
    .from(proposalTemplates)
    .where(and(eq(proposalTemplates.id, id), eq(proposalTemplates.organizationId, organizationId)))
    .limit(1);
  if (!tpl) return { ok: false, error: "Template not found." };
  const cleared = await db
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
        eq(proposalTemplates.docxStoragePath, tpl.docxStoragePath),
      ),
    )
    .returning({ id: proposalTemplates.id });
  if (cleared.length === 0) return { ok: false, error: "The template's file changed meanwhile. Reload the page and try again." };
  const file = tpl.docxStoragePath ? await releaseStoredFile({ organizationId, storagePath: tpl.docxStoragePath, reason: "deleted" }) : "skipped";
  await releaseSupersededTemplateFiles(organizationId, id);
  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "template.clear_docx",
    resourceType: "template",
    resourceId: id,
    metadata: { fileReleased: file !== "skipped" },
  });
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
