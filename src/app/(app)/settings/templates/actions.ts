"use server";

import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import {
  proposalTemplates,
  type TemplateSectionSeed,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg, requireOrgAdmin } from "@/lib/auth-helpers";
import { STARTER_TEMPLATES } from "@/lib/template-types";

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
        sectionSeed: starter!.sectionSeed,
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
