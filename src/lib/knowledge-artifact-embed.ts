/**
 * BL-AIP-4 — chunk + embed one knowledge artifact.
 *
 * Moved out of the `embedArtifactAction` server action so the
 * brain-index cron (no session) and the action (auth-gated, then
 * revalidates) share one implementation. Idempotent: existing chunks
 * for the artifact are replaced, and a mid-batch failure rolls back to
 * no chunks rather than a partial set.
 *
 * Every write carries `organizationId`; callers own auth.
 */
import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeArtifactChunks, knowledgeArtifacts } from "@/db/schema";
import { embedBatch, vectorToPgLiteral } from "@/lib/embeddings";
import { approxTokenCount, chunkText } from "@/lib/text-chunk";
import { log } from "@/lib/log";

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

export async function embedArtifact(input: {
  organizationId: string;
  artifactId: string;
}): Promise<EmbedArtifactResult> {
  const { organizationId, artifactId } = input;

  const [artifact] = await db
    .select({ rawText: knowledgeArtifacts.rawText })
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
    .where(
      and(
        eq(knowledgeArtifactChunks.organizationId, organizationId),
        eq(knowledgeArtifactChunks.artifactId, artifactId),
      ),
    );

  let provider = "stub";
  let model = "stub";
  let stubbed = true;

  // The whole insert loop is wrapped so any mid-batch failure results
  // in a clean slate rather than a half-embedded artifact.
  try {
    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const slice = chunks.slice(i, i + EMBED_BATCH);
      const result = await embedBatch(
        slice.map((c) => c.content),
        { organizationId, feature: "embedding" },
      );
      provider = result.provider;
      model = result.model;
      stubbed = result.stubbed;

      if (result.vectors.length !== slice.length) {
        throw new Error(
          `Embedding provider returned ${result.vectors.length} vectors for ${slice.length} chunks.`,
        );
      }

      // Sequential inserts with a raw cast to vector (Neon/pgbouncer
      // rule; chunk counts are small).
      for (let j = 0; j < slice.length; j++) {
        const c = slice[j]!;
        const literal = vectorToPgLiteral(result.vectors[j]!);
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
  } catch (err) {
    await db
      .delete(knowledgeArtifactChunks)
      .where(
        and(
          eq(knowledgeArtifactChunks.organizationId, organizationId),
          eq(knowledgeArtifactChunks.artifactId, artifactId),
        ),
      )
      .catch((cleanupErr) => {
        log.error("[embedArtifact]", "partial chunks could not be rolled back", {
          error: cleanupErr,
        });
      });
    log.error("[embedArtifact]", "chunk insert failed", { error: err, artifactId });
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Embedding failed mid-batch; please retry.",
    };
  }

  return { ok: true, chunks: chunks.length, provider, model, stubbed };
}
