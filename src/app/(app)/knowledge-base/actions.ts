"use server";

import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import {
  knowledgeEntries,
  type KnowledgeKind,
  type KnowledgeOutcomeLabel,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import {
  backfillEntryEmbeddings,
  embedKnowledgeEntry,
} from "@/lib/knowledge-entry-embed";

const KINDS: KnowledgeKind[] = [
  "capability",
  "past_performance",
  "personnel",
  "boilerplate",
];

export async function listKnowledgeEntriesAction(options: {
  search?: string;
  kind?: KnowledgeKind | "all";
  outcome?: KnowledgeOutcomeLabel | "all";
  includeArchived?: boolean;
} = {}) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const filters = [eq(knowledgeEntries.organizationId, organizationId)];
  if (options.kind && options.kind !== "all") {
    filters.push(eq(knowledgeEntries.kind, options.kind));
  }
  if (options.outcome && options.outcome !== "all") {
    filters.push(eq(knowledgeEntries.outcomeLabel, options.outcome));
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
      outcomeLabel: knowledgeEntries.outcomeLabel,
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
    outcomeLabel: r.outcomeLabel,
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
    const finalTitle = input.title.trim();
    const finalBody = input.body?.trim() ?? "";
    const [row] = await db
      .insert(knowledgeEntries)
      .values({
        organizationId,
        kind: input.kind,
        title: finalTitle,
        body: finalBody,
        tags: dedupTags(input.tags ?? []),
        createdByUserId: user.id,
      })
      .returning({ id: knowledgeEntries.id });
    if (row) {
      // Embed best-effort so Brain Suggest can rank this entry. Don't
      // block creation if it fails — backfill can patch later.
      await embedKnowledgeEntry(row.id, finalTitle, finalBody).catch((err) => {
        console.warn("[createKnowledgeEntryAction] embed failed", err);
      });
    }
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

    // Re-embed when title or body changed so the vector matches the
    // current content. Tag-only edits don't need re-embedding.
    if (input.title !== undefined || input.body !== undefined) {
      const [latest] = await db
        .select({
          title: knowledgeEntries.title,
          body: knowledgeEntries.body,
        })
        .from(knowledgeEntries)
        .where(eq(knowledgeEntries.id, id))
        .limit(1);
      if (latest) {
        await embedKnowledgeEntry(id, latest.title, latest.body).catch(
          (err) => {
            console.warn("[updateKnowledgeEntryAction] re-embed failed", err);
          },
        );
      }
    }

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

/**
 * Phase 10f: backfill embeddings for every entry in the org that
 * doesn't yet have one. Safe to run repeatedly. Used by the
 * "Embed missing entries" button in the corpus header.
 */
export async function backfillKnowledgeEntryEmbeddingsAction(): Promise<
  | { ok: true; embedded: number; skipped: number }
  | { ok: false; error: string }
> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  try {
    const result = await backfillEntryEmbeddings(organizationId);
    revalidatePath("/knowledge-base");
    return { ok: true, ...result };
  } catch (err) {
    console.error("[backfillKnowledgeEntryEmbeddingsAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Backfill failed.",
    };
  }
}
