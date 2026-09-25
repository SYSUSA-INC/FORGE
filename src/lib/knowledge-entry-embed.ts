/**
 * Helpers for embedding curated knowledge_entry rows.
 *
 * Phase 10f extension: each entry's `title + "\n\n" + body` gets a
 * 1536-dim embedding so the Brain Suggest panel can rank entries via
 * real cosine similarity (the 10e implementation used token overlap
 * because entries weren't embedded yet).
 *
 * BL-AIP-4 — every write also records `embedding_provider` /
 * `embedding_model` so the brain-index cron can find stub or stale
 * vectors and re-embed them once a live provider is configured, and
 * every call is metered through `EmbedContext`.
 *
 * Entries are batch-friendly — we embed up to 64 at a time.
 *
 * Every write is scoped by organizationId as well as the entry id
 * (BL-TENANT-AUDIT 2026-09): callers verify ownership first, but the
 * embedding text is caller-supplied, so the UPDATE carries the tenant
 * filter itself rather than trusting the id.
 */
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { embedBatch, vectorToPgLiteral } from "@/lib/embeddings";
import { log } from "@/lib/log";

const BATCH = 64;

export type EntryEmbedRow = { id: string; title: string; body: string };

/**
 * Embed a single entry. Used on approval and on manual create so
 * new entries are searchable immediately.
 */
export async function embedKnowledgeEntry(
  organizationId: string,
  entryId: string,
  title: string,
  body: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const composed = composeEntryText(title, body);
  if (!composed.trim()) return { ok: false, error: "Entry has no text." };

  try {
    const r = await embedBatch([composed], { organizationId, feature: "embedding" });
    const literal = vectorToPgLiteral(r.vectors[0]!);
    await db.execute(sql`
      UPDATE knowledge_entry
      SET embedding = ${literal}::vector,
          embedded_at = now(),
          embedding_provider = ${r.provider},
          embedding_model = ${r.model}
      WHERE id = ${entryId}
        AND organization_id = ${organizationId}
    `);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Embedding failed.",
    };
  }
}

/**
 * Embed a set of entries for one tenant in batches. Rows with no text
 * are skipped; a failed batch is logged and skipped so the rest still
 * land. Returns counts plus the provider used.
 */
export async function embedKnowledgeEntries(
  organizationId: string,
  rows: EntryEmbedRow[],
): Promise<{ embedded: number; skipped: number; provider: string }> {
  let embedded = 0;
  let skipped = 0;
  let provider = "";

  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const valid = slice
      .map((r) => ({ row: r, text: composeEntryText(r.title, r.body) }))
      .filter((p) => p.text.trim().length > 0);
    skipped += slice.length - valid.length;
    if (valid.length === 0) continue;

    let vectors: number[][];
    try {
      const result = await embedBatch(
        valid.map((v) => v.text),
        { organizationId, feature: "embedding" },
      );
      vectors = result.vectors;
      provider = result.provider;
      for (let j = 0; j < valid.length; j++) {
        const literal = vectorToPgLiteral(vectors[j]!);
        try {
          await db.execute(sql`
            UPDATE knowledge_entry
            SET embedding = ${literal}::vector,
                embedded_at = now(),
                embedding_provider = ${result.provider},
                embedding_model = ${result.model}
            WHERE id = ${valid[j]!.row.id}
              AND organization_id = ${organizationId}
          `);
          embedded += 1;
        } catch (err) {
          log.error("[embedKnowledgeEntries]", "update failed", {
            rowId: valid[j]!.row.id,
            error: err,
          });
          skipped += 1;
        }
      }
    } catch (err) {
      log.error("[embedKnowledgeEntries]", "batch failed", { error: err });
      skipped += valid.length;
    }
  }

  return { embedded, skipped, provider };
}

/**
 * Backfill embeddings for every entry in the org that doesn't have
 * one yet. Returns counts of embedded vs skipped (e.g. archived,
 * empty body).
 */
export async function backfillEntryEmbeddings(
  organizationId: string,
): Promise<{ embedded: number; skipped: number }> {
  // Pull rows missing an embedding. We use raw SQL for the IS NULL
  // check on a column drizzle thinks is text but is really pgvector.
  const result = await db.execute(sql`
    SELECT id, title, body
    FROM knowledge_entry
    WHERE organization_id = ${organizationId}
      AND archived_at IS NULL
      AND embedding IS NULL
  `);
  const rows =
    ((result as unknown as { rows?: EntryEmbedRow[] }).rows ??
      (result as unknown as EntryEmbedRow[])) as EntryEmbedRow[];

  const { embedded, skipped } = await embedKnowledgeEntries(organizationId, rows);
  return { embedded, skipped };
}

function composeEntryText(title: string, body: string): string {
  return [title.trim(), body.trim()].filter(Boolean).join("\n\n");
}
