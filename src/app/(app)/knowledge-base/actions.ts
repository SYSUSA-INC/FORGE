"use server";

import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { knowledgeEntries, type KnowledgeKind } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";

const KINDS: KnowledgeKind[] = [
  "capability",
  "past_performance",
  "personnel",
  "boilerplate",
];

export async function listKnowledgeEntriesAction(options: {
  search?: string;
  kind?: KnowledgeKind | "all";
  includeArchived?: boolean;
} = {}) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const filters = [eq(knowledgeEntries.organizationId, organizationId)];
  if (options.kind && options.kind !== "all") {
    filters.push(eq(knowledgeEntries.kind, options.kind));
  }
  if (!options.includeArchived) {
    filters.push(sql`${knowledgeEntries.archivedAt} IS NULL`);
  }
  if (options.search?.trim()) {
    const q = `%${options.search.trim()}%`;
    filters.push(
      or(
        ilike(knowledgeEntries.title, q),
        ilike(knowledgeEntries.body, q),
      )!,
    );
  }

  const rows = await db
    .select({
      id: knowledgeEntries.id,
      kind: knowledgeEntries.kind,
      title: knowledgeEntries.title,
      body: knowledgeEntries.body,
      tags: knowledgeEntries.tags,
      reuseCount: knowledgeEntries.reuseCount,
      archivedAt: knowledgeEntries.archivedAt,
      updatedAt: knowledgeEntries.updatedAt,
    })
    .from(knowledgeEntries)
    .where(and(...filters))
    .orderBy(desc(knowledgeEntries.updatedAt))
    .limit(200);

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    tags: r.tags ?? [],
    reuseCount: r.reuseCount,
    archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function getKnowledgeEntryAction(id: string) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const [row] = await db
    .select()
    .from(knowledgeEntries)
    .where(
      and(
        eq(knowledgeEntries.id, id),
        eq(knowledgeEntries.organizationId, organizationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createKnowledgeEntryAction(input: {
  kind: KnowledgeKind;
  title: string;
  body?: string;
  tags?: string[];
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!KINDS.includes(input.kind)) {
    return { ok: false, error: "Invalid kind." };
  }
  if (!input.title.trim()) {
    return { ok: false, error: "Title is required." };
  }

  try {
    const [row] = await db
      .insert(knowledgeEntries)
      .values({
        organizationId,
        kind: input.kind,
        title: input.title.trim(),
        body: input.body?.trim() ?? "",
        tags: dedupTags(input.tags ?? []),
        createdByUserId: user.id,
      })
      .returning({ id: knowledgeEntries.id });
    revalidatePath("/knowledge-base");
    return { ok: true, id: row!.id };
  } catch (err) {
    console.error("[createKnowledgeEntryAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Create failed.",
    };
  }
}

export async function createKnowledgeEntryAndGoAction(input: {
  kind: KnowledgeKind;
  title: string;
  body?: string;
  tags?: string[];
}): Promise<void> {
  const res = await createKnowledgeEntryAction(input);
  if (res.ok) redirect(`/knowledge-base/${res.id}`);
  throw new Error(res.ok ? "unreachable" : res.error);
}

export async function updateKnowledgeEntryAction(
  id: string,
  input: {
    kind?: KnowledgeKind;
    title?: string;
    body?: string;
    tags?: string[];
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  try {
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (input.kind !== undefined) {
      if (!KINDS.includes(input.kind))
        return { ok: false, error: "Invalid kind." };
      update.kind = input.kind;
    }
    if (input.title !== undefined) update.title = input.title.trim();
    if (input.body !== undefined) update.body = input.body.trim();
    if (input.tags !== undefined) update.tags = dedupTags(input.tags);
    await db
      .update(knowledgeEntries)
      .set(update)
      .where(
        and(
          eq(knowledgeEntries.id, id),
          eq(knowledgeEntries.organizationId, organizationId),
        ),
      );
    revalidatePath("/knowledge-base");
    revalidatePath(`/knowledge-base/${id}`);
    return { ok: true };
  } catch (err) {
    console.error("[updateKnowledgeEntryAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Update failed.",
    };
  }
}

export async function archiveKnowledgeEntryAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await db
    .update(knowledgeEntries)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(knowledgeEntries.id, id),
        eq(knowledgeEntries.organizationId, organizationId),
      ),
    );
  revalidatePath("/knowledge-base");
  return { ok: true };
}

export async function unarchiveKnowledgeEntryAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await db
    .update(knowledgeEntries)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(knowledgeEntries.id, id),
        eq(knowledgeEntries.organizationId, organizationId),
      ),
    );
  revalidatePath("/knowledge-base");
  return { ok: true };
}

export async function deleteKnowledgeEntryAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await db
    .delete(knowledgeEntries)
    .where(
      and(
        eq(knowledgeEntries.id, id),
        eq(knowledgeEntries.organizationId, organizationId),
      ),
    );
  revalidatePath("/knowledge-base");
  return { ok: true };
}

function dedupTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim().slice(0, 64);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.slice(0, 32);
}
