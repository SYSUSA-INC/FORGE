/**
 * Helpers for embedding curated knowledge_entry rows.
 *
 * Phase 10f extension: each entry's `title + "\n\n" + body` gets a
 * 1536-dim embedding so the Brain Suggest panel can rank entries via
 * real cosine similarity (the 10e implementation used token overlap
 * because entries weren't embedded yet).
 *
 * Entries are batch-friendly — we embed up to 64 at a time.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { embedBatch, vectorToPgLiteral } from "@/lib/embeddings";

const BATCH = 64;

/**
 * Embed a single entry. Used on approval and on manual create so
 * new entries are searchable immediately.
 */
export async function embedKnowledgeEntry(
  entryId: string,
  title: string,
  body: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const composed = composeEntryText(title, body);
  if (!composed.trim()) return { ok: false, error: "Entry has no text." };

  try {
    const r = await embedBatch([composed]);
    const literal = vectorToPgLiteral(r.vectors[0]!);
    await db.execute(sql`
      UPDATE knowledge_entry
      SET embedding = ${literal}::vector,
          embedded_at = now()
      WHERE id = ${entryId}
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
    ((result as unknown as {
      rows?: { id: string; title: string; body: string }[];
    }).rows ??
      (result as unknown as { id: string; title: string; body: string }[])) as {
      id: string;
      title: string;
      body: string;
    }[];

  let embedded = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const texts = slice.map((r) => composeEntryText(r.title, r.body));

    const valid = slice
      .map((r, idx) => ({ row: r, text: texts[idx]! }))
      .filter((p) => p.text.trim().length > 0);
    if (valid.length === 0) {
      skipped += slice.length;
      continue;
    }

    let vectors: number[][];
    try {
      const result = await embedBatch(valid.map((v) => v.text));
      vectors = result.vectors;
    } catch (err) {
      console.error("[backfillEntryEmbeddings] batch failed", err);
      skipped += slice.length;
      continue;
    }

    for (let j = 0; j < valid.length; j++) {
      const literal = vectorToPgLiteral(vectors[j]!);
      try {
        await db.execute(sql`
          UPDATE knowledge_entry
          SET embedding = ${literal}::vector,
              embedded_at = now()
          WHERE id = ${valid[j]!.row.id}
        `);
        embedded += 1;
      } catch (err) {
        console.error(
          `[backfillEntryEmbeddings] update ${valid[j]!.row.id} failed`,
          err,
        );
        skipped += 1;
      }
    }
    skipped += slice.length - valid.length;
  }

  return { embedded, skipped };
}

function composeEntryText(title: string, body: string): string {
  return [title.trim(), body.trim()].filter(Boolean).join("\n\n");
}
