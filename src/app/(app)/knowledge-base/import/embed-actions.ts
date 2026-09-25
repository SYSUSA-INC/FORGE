"use server";

import { and, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { knowledgeArtifacts } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import {
  embedBatch,
  getEmbeddingProviderStatus,
  vectorToPgLiteral,
} from "@/lib/embeddings";
import { embedArtifact } from "@/lib/knowledge-artifact-embed";
import type { EmbedArtifactResult } from "@/lib/knowledge-artifact-embed";
import { log } from "@/lib/log";

export type { EmbedArtifactResult };

/**
 * Chunk an artifact's raw_text, embed each chunk, and persist them
 * into knowledge_artifact_chunk. Idempotent: existing chunks for the
 * artifact are replaced. BL-AIP-4 — the implementation lives in
 * src/lib/knowledge-artifact-embed.ts so the brain-index cron shares it.
 */
export async function embedArtifactAction(
  artifactId: string,
): Promise<EmbedArtifactResult> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const result = await embedArtifact({ organizationId, artifactId });
  if (result.ok) {
    revalidatePath(`/knowledge-base/import/${artifactId}`);
    revalidatePath("/knowledge-base/import");
  }
  return result;
}

export type SearchHit = {
  artifactId: string;
  artifactTitle: string;
  artifactKind: string;
  artifactFileName: string;
  chunkId: string;
  chunkIndex: number;
  content: string;
  charStart: number;
  charEnd: number;
  /** Cosine similarity in [-1, 1] (1 = identical direction). */
  similarity: number;
};

export type SearchResult =
  | { ok: true; hits: SearchHit[]; provider: string; stubbed: boolean }
  | { ok: false; error: string };

/**
 * Semantic search across the org's corpus. Embeds the query, runs
 * cosine similarity against knowledge_artifact_chunk.embedding via
 * pgvector's `<=>` operator (which is cosine DISTANCE; we convert to
 * similarity in the SELECT).
 */
export async function semanticSearchAction(
  query: string,
  opts: { limit?: number } = {},
): Promise<SearchResult> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const trimmed = (query ?? "").trim();
  if (trimmed.length < 3) {
    return { ok: false, error: "Type at least 3 characters to search." };
  }

  const limit = Math.max(1, Math.min(50, opts.limit ?? 10));

  let queryEmbedding: number[];
  let provider = "stub";
  let stubbed = true;
  try {
    const r = await embedBatch([trimmed], { organizationId, feature: "embedding_query" });
    queryEmbedding = r.vectors[0]!;
    provider = r.provider;
    stubbed = r.stubbed;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not embed query.",
    };
  }

  const literal = vectorToPgLiteral(queryEmbedding);

  let rows: {
    artifact_id: string;
    artifact_title: string;
    artifact_kind: string;
    artifact_file_name: string;
    chunk_id: string;
    chunk_index: number;
    content: string;
    char_start: number;
    char_end: number;
    similarity: number;
  }[] = [];

  try {
    const result = await db.execute(sql`
      SELECT
        c.id           AS chunk_id,
        c.chunk_index  AS chunk_index,
        c.content      AS content,
        c.char_start   AS char_start,
        c.char_end     AS char_end,
        a.id           AS artifact_id,
        a.title        AS artifact_title,
        a.kind         AS artifact_kind,
        a.file_name    AS artifact_file_name,
        1 - (c.embedding <=> ${literal}::vector) AS similarity
      FROM knowledge_artifact_chunk c
      INNER JOIN knowledge_artifact a ON a.id = c.artifact_id
      WHERE c.organization_id = ${organizationId}
        AND a.archived_at IS NULL
        AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> ${literal}::vector
      LIMIT ${limit}
    `);
    rows = ((result as unknown as { rows?: typeof rows }).rows ??
      (result as unknown as typeof rows)) as typeof rows;
  } catch (err) {
    log.error("[semanticSearchAction]", "query failed", { error: err });
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Search failed: ${err.message}`
          : "Search failed.",
    };
  }

  const hits: SearchHit[] = rows.map((r) => ({
    artifactId: r.artifact_id,
    artifactTitle: r.artifact_title,
    artifactKind: r.artifact_kind,
    artifactFileName: r.artifact_file_name,
    chunkId: r.chunk_id,
    chunkIndex: r.chunk_index,
    content: r.content,
    charStart: r.char_start,
    charEnd: r.char_end,
    similarity: typeof r.similarity === "string"
      ? Number(r.similarity)
      : r.similarity,
  }));

  return {
    ok: true,
    hits,
    provider,
    stubbed,
  };
}

/**
 * Lightweight per-artifact summary so the UI can show "indexed X of Y"
 * for its corpus.
 */
export async function getEmbeddingsStatusAction() {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const status = getEmbeddingProviderStatus();

  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int                   AS chunk_count,
      COUNT(DISTINCT artifact_id)::int AS artifact_count
    FROM knowledge_artifact_chunk
    WHERE organization_id = ${organizationId}
  `);
  const rows =
    ((result as unknown as {
      rows?: { chunk_count: number; artifact_count: number }[];
    }).rows ??
      (result as unknown as { chunk_count: number; artifact_count: number }[]));
  const summary = rows[0] ?? { chunk_count: 0, artifact_count: 0 };

  return {
    chunkCount: summary.chunk_count,
    artifactCount: summary.artifact_count,
    provider: status.active.name,
    providerReason: status.active.reason,
    stub: status.active.name === "stub",
  };
}

/**
 * Re-embed every artifact in the org that doesn't currently have any
 * chunks. Useful one-shot after enabling the embeddings provider.
 */
export async function reembedMissingArtifactsAction(): Promise<
  { ok: true; embedded: number; skipped: number } | { ok: false; error: string }
> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const indexed = await db
    .select({
      id: knowledgeArtifacts.id,
      rawTextLen: sql<number>`length(${knowledgeArtifacts.rawText})`,
    })
    .from(knowledgeArtifacts)
    .where(
      and(
        eq(knowledgeArtifacts.organizationId, organizationId),
        eq(knowledgeArtifacts.status, "indexed"),
      ),
    )
    .orderBy(desc(knowledgeArtifacts.createdAt));

  const counts = await db.execute(sql`
    SELECT artifact_id, COUNT(*)::int AS n
    FROM knowledge_artifact_chunk
    WHERE organization_id = ${organizationId}
    GROUP BY artifact_id
  `);
  const countsRows =
    ((counts as unknown as {
      rows?: { artifact_id: string; n: number }[];
    }).rows ??
      (counts as unknown as { artifact_id: string; n: number }[]));
  const have = new Map(countsRows.map((r) => [r.artifact_id, r.n]));

  let embedded = 0;
  let skipped = 0;
  for (const row of indexed) {
    if ((have.get(row.id) ?? 0) > 0 || (row.rawTextLen ?? 0) === 0) {
      skipped += 1;
      continue;
    }
    const r = await embedArtifact({ organizationId, artifactId: row.id });
    if (r.ok) embedded += 1;
    else skipped += 1;
  }

  revalidatePath("/knowledge-base/import");
  return { ok: true, embedded, skipped };
}
