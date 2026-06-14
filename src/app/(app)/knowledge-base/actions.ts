"use server";

import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  knowledgeEntries,
  type KnowledgeKind,
  type KnowledgeOutcomeLabel,
} from "@/db/schema";
import {
  requireAuth,
  requireCurrentOrg,
  requireOrgAdmin,
} from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import {
  backfillEntryEmbeddings,
  embedKnowledgeEntry,
} from "@/lib/knowledge-entry-embed";
import { scoreKnowledgeEntry } from "@/lib/knowledge-quality";
import { log } from "@/lib/log";

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
    const finalTags = dedupTags(input.tags ?? []);
    // BL-10 Phase D-2 — score on save. Pure heuristic, no AI call.
    const quality = scoreKnowledgeEntry({
      kind: input.kind,
      title: finalTitle,
      body: finalBody,
      tags: finalTags,
      metadata: {},
    });
    const [row] = await db
      .insert(knowledgeEntries)
      .values({
        organizationId,
        kind: input.kind,
        title: finalTitle,
        body: finalBody,
        tags: finalTags,
        createdByUserId: user.id,
        qualityScore: quality.score,
        qualityScoreFactors: quality.factors,
        qualityScoredAt: new Date(),
      })
      .returning({ id: knowledgeEntries.id });
    if (row) {
      // Embed best-effort so Brain Suggest can rank this entry. Don't
      // block creation if it fails — backfill can patch later.
      await embedKnowledgeEntry(row.id, finalTitle, finalBody).catch((err) => {
        log.warn("[createKnowledgeEntryAction]", "embed failed", { error: err });
      });
    }
    await recordAudit({
      organizationId,
      actor: { userId: user.id, email: user.email },
      action: "knowledge_entry.create",
      resourceType: "knowledge_entry",
      resourceId: row!.id,
      metadata: { kind: input.kind, title: finalTitle },
    });
    revalidatePath("/knowledge-base");
    return { ok: true, id: row!.id };
  } catch (err) {
    log.error("[createKnowledgeEntryAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Create failed.",
    };
  }
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
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  try {
    // Load current values so we can score against the post-update shape
    // (input is partial). Org-scoped — won't load another tenant's row.
    const [current] = await db
      .select({
        kind: knowledgeEntries.kind,
        title: knowledgeEntries.title,
        body: knowledgeEntries.body,
        tags: knowledgeEntries.tags,
        metadata: knowledgeEntries.metadata,
      })
      .from(knowledgeEntries)
      .where(
        and(
          eq(knowledgeEntries.id, id),
          eq(knowledgeEntries.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (!current) {
      return { ok: false, error: "Entry not found." };
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (input.kind !== undefined) {
      if (!KINDS.includes(input.kind))
        return { ok: false, error: "Invalid kind." };
      update.kind = input.kind;
    }
    if (input.title !== undefined) update.title = input.title.trim();
    if (input.body !== undefined) update.body = input.body.trim();
    if (input.tags !== undefined) update.tags = dedupTags(input.tags);

    // BL-10 Phase D-2 — re-score on every save against the merged
    // post-update shape so the score reflects the change even when
    // tags-only edits don't trigger re-embedding.
    const merged = {
      kind: (update.kind as KnowledgeKind | undefined) ?? current.kind,
      title: (update.title as string | undefined) ?? current.title,
      body: (update.body as string | undefined) ?? current.body,
      tags: (update.tags as string[] | undefined) ?? current.tags,
      metadata: current.metadata,
    };
    const quality = scoreKnowledgeEntry(merged);
    update.qualityScore = quality.score;
    update.qualityScoreFactors = quality.factors;
    update.qualityScoredAt = new Date();

    await db
      .update(knowledgeEntries)
      .set(update)
      .where(
        and(
          eq(knowledgeEntries.id, id),
          eq(knowledgeEntries.organizationId, organizationId),
        ),
      );
    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "knowledge_entry.update",
      resourceType: "knowledge_entry",
      resourceId: id,
      metadata: { fields: Object.keys(input) },
    });

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
            log.warn("[updateKnowledgeEntryAction]", "re-embed failed", { error: err });
          },
        );
      }
    }

    revalidatePath("/knowledge-base");
    revalidatePath(`/knowledge-base/${id}`);
    return { ok: true };
  } catch (err) {
    log.error("[updateKnowledgeEntryAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Update failed.",
    };
  }
}

export async function archiveKnowledgeEntryAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
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
  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "knowledge_entry.archive",
    resourceType: "knowledge_entry",
    resourceId: id,
  });
  revalidatePath("/knowledge-base");
  return { ok: true };
}

export async function unarchiveKnowledgeEntryAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
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
  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "knowledge_entry.unarchive",
    resourceType: "knowledge_entry",
    resourceId: id,
  });
  revalidatePath("/knowledge-base");
  return { ok: true };
}

export async function deleteKnowledgeEntryAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await db
    .delete(knowledgeEntries)
    .where(
      and(
        eq(knowledgeEntries.id, id),
        eq(knowledgeEntries.organizationId, organizationId),
      ),
    );
  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "knowledge_entry.delete",
    resourceType: "knowledge_entry",
    resourceId: id,
  });
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
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  try {
    const result = await backfillEntryEmbeddings(organizationId);
    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "knowledge_entry.backfill_embeddings",
      resourceType: "knowledge_entry",
      metadata: { embedded: result.embedded, skipped: result.skipped },
    });
    revalidatePath("/knowledge-base");
    return { ok: true, ...result };
  } catch (err) {
    log.error("[backfillKnowledgeEntryEmbeddingsAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Backfill failed.",
    };
  }
}

/**
 * BL-10 Phase D-2 — backfill quality scores for entries that haven't
 * been scored yet (or were scored before this column existed). Org-
 * admin gated; processes up to 100 per click so the admin can drain
 * a large corpus across multiple clicks without long-running calls.
 */
export type ScoreBackfillResult =
  | { ok: true; processed: number; remaining: number }
  | { ok: false; error: string };

export async function backfillKnowledgeEntryQualityScoresAction(): Promise<ScoreBackfillResult> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  try {
    const candidates = await db
      .select({
        id: knowledgeEntries.id,
        kind: knowledgeEntries.kind,
        title: knowledgeEntries.title,
        body: knowledgeEntries.body,
        tags: knowledgeEntries.tags,
        metadata: knowledgeEntries.metadata,
      })
      .from(knowledgeEntries)
      .where(
        and(
          eq(knowledgeEntries.organizationId, organizationId),
          isNull(knowledgeEntries.qualityScoredAt),
        ),
      )
      .limit(100);

    let processed = 0;
    for (const c of candidates) {
      try {
        const quality = scoreKnowledgeEntry({
          kind: c.kind,
          title: c.title,
          body: c.body,
          tags: c.tags,
          metadata: c.metadata,
        });
        await db
          .update(knowledgeEntries)
          .set({
            qualityScore: quality.score,
            qualityScoreFactors: quality.factors,
            qualityScoredAt: new Date(),
          })
          .where(
            and(
              eq(knowledgeEntries.id, c.id),
              eq(knowledgeEntries.organizationId, organizationId),
            ),
          );
        processed += 1;
      } catch (err) {
        log.error(
          "[backfillKnowledgeEntryQualityScoresAction]",
          "row failed",
          { error: err, entryId: c.id, organizationId },
        );
      }
    }

    // Cheap remaining count for the UI summary.
    const [{ n } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(knowledgeEntries)
      .where(
        and(
          eq(knowledgeEntries.organizationId, organizationId),
          isNull(knowledgeEntries.qualityScoredAt),
        ),
      );

    revalidatePath("/knowledge-base");
    return { ok: true, processed, remaining: Number(n) };
  } catch (err) {
    log.error("[backfillKnowledgeEntryQualityScoresAction]", "error", {
      error: err,
    });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Backfill failed.",
    };
  }
}
