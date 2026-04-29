"use server";

import { and, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  knowledgeArtifactChunks,
  knowledgeArtifacts,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import {
  embedBatch,
  getEmbeddingProviderStatus,
  vectorToPgLiteral,
} from "@/lib/embeddings";
import { approxTokenCount, chunkText } from "@/lib/text-chunk";

const EMBED_BATCH = 32;

export type EmbedArtifactResult =
  | {
      ok: true;
      chunks: number;
      provider: string;
      model: string;
      stubbed: boolean;
    }
  | { ok: false; error: string };

/**
 * Chunk an artifact's raw_text, embed each chunk, and persist them
 * into knowledge_artifact_chunk. Idempotent: deletes existing chunks
 * for the artifact first so re-runs replace, not duplicate.
 */
export async function embedArtifactAction(
  artifactId: string,
): Promise<EmbedArtifactResult> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [artifact] = await db
    .select()
    .from(knowledgeArtifacts)
    .where(
      and(
        eq(knowledgeArtifacts.id, artifactId),
        eq(knowledgeArtifacts.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!artifact) return { ok: false, error: "Artifact not found." };
  if (!artifact.rawText || artifact.rawText.trim().length === 0) {
    return {
      ok: false,
      error:
        "Artifact has no extracted text yet. Wait for indexing to finish, or re-upload if it failed.",
    };
  }

  const chunks = chunkText(artifact.rawText);
  if (chunks.length === 0) {
    return { ok: false, error: "Could not split the artifact into chunks." };
  }

  // Replace existing chunks for this artifact.
  await db
    .delete(knowledgeArtifactChunks)
    .where(eq(knowledgeArtifactChunks.artifactId, artifactId));

  // Batch embed — OpenAI accepts arrays; stub does too.
  let provider = "stub";
  let model = "stub";
  let stubbed = true;

  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const slice = chunks.slice(i, i + EMBED_BATCH);
    const texts = slice.map((c) => c.content);
    const result = await embedBatch(texts);
    provider = result.provider;
    model = result.model;
    stubbed = result.stubbed;

    // Insert sequentially with raw cast to vector. Done one-at-a-time
    // because pgvector text-cast on bulk inserts is awkward through
    // Drizzle's parameter binding; chunk counts are small (<200).
    for (let j = 0; j < slice.length; j++) {
      const c = slice[j]!;
      const vec = result.vectors[j]!;
      const literal = vectorToPgLiteral(vec);
      await db.execute(sql`
        INSERT INTO knowledge_artifact_chunk
          (organization_id, artifact_id, chunk_index, content,
           embedding, token_count, char_start, char_end,
           embedding_provider, embedding_model, embedded_at)
        VALUES
          (${organizationId}, ${artifactId}, ${c.index}, ${c.content},
           ${literal}::vector, ${approxTokenCount(c.content)},
           ${c.charStart}, ${c.charEnd},
           ${result.provider}, ${result.model}, now())
      `);
    }
  }

  revalidatePath(`/knowledge-base/import/${artifactId}`);
  revalidatePath("/knowledge-base/import");

  return {
    ok: true,
    chunks: chunks.length,
    provider,
    model,
    stubbed,
  };
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
    const r = await embedBatch([trimmed]);
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
    console.error("[semanticSearchAction] query failed", err);
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
    const r = await embedArtifactAction(row.id);
    if (r.ok) embedded += 1;
    else skipped += 1;
  }

  return { ok: true, embedded, skipped };
}
