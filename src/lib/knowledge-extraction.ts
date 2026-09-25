/**
 * BL-AIP-4 — one Brain extraction pass over an artifact.
 *
 * Moved out of `startKnowledgeExtractionAction` so the brain-index cron
 * can run it without a session; the action wraps it with auth, audit
 * and revalidation. Adds de-duplication: candidates whose normalised
 * `kind::title` already exists among this artifact's earlier candidates
 * or the tenant's curated entries are dropped instead of re-queued.
 *
 * Every read/write carries `organizationId`; callers own auth.
 */
import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  knowledgeArtifacts,
  knowledgeEntries,
  knowledgeExtractionCandidates,
  knowledgeExtractionRuns,
  type KnowledgeKind,
} from "@/db/schema";
import {
  KNOWLEDGE_EXTRACT_PROMPT_VERSION,
  aiExtractKnowledgeFromArtifact,
} from "@/lib/knowledge-extract";
import { candidateKey, dedupCandidates } from "@/lib/knowledge-dedup";

export type ExtractionRunResult =
  | {
      ok: true;
      runId: string;
      candidateCount: number;
      skippedDuplicates: number;
      stubbed: boolean;
      provider: string;
      model: string;
    }
  | { ok: false; error: string };

const ENTRY_KEY_LIMIT = 5000;

export async function runKnowledgeExtraction(input: {
  organizationId: string;
  artifactId: string;
  startedByUserId: string | null;
  /**
   * When true a stub-mode provider fails the run instead of inserting
   * the "Stub-mode placeholder" candidate. The cron sets it; the manual
   * action keeps the placeholder so the UI flow stays testable.
   */
  skipStub?: boolean;
}): Promise<ExtractionRunResult> {
  const { organizationId, artifactId } = input;

  const [artifact] = await db
    .select({
      id: knowledgeArtifacts.id,
      kind: knowledgeArtifacts.kind,
      title: knowledgeArtifacts.title,
      fileName: knowledgeArtifacts.fileName,
      tags: knowledgeArtifacts.tags,
      rawText: knowledgeArtifacts.rawText,
    })
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

  // Insert the run row first so progress is visible even if the AI
  // call takes a while.
  const [run] = await db
    .insert(knowledgeExtractionRuns)
    .values({
      organizationId,
      artifactId: artifact.id,
      status: "running",
      promptVersion: KNOWLEDGE_EXTRACT_PROMPT_VERSION,
      startedAt: new Date(),
      startedByUserId: input.startedByUserId,
    })
    .returning({ id: knowledgeExtractionRuns.id });
  if (!run) return { ok: false, error: "Could not create extraction run." };

  const failRun = async (message: string) => {
    await db
      .update(knowledgeExtractionRuns)
      .set({ status: "failed", errorMessage: message, finishedAt: new Date() })
      .where(
        and(
          eq(knowledgeExtractionRuns.organizationId, organizationId),
          eq(knowledgeExtractionRuns.id, run.id),
        ),
      );
  };

  const aiRes = await aiExtractKnowledgeFromArtifact({
    organizationId,
    artifactKind: artifact.kind,
    artifactTitle: artifact.title || artifact.fileName,
    artifactTags: artifact.tags ?? [],
    rawText: artifact.rawText,
  });

  if (!aiRes.ok) {
    await failRun(aiRes.error);
    return { ok: false, error: aiRes.error };
  }
  if (input.skipStub && aiRes.stubbed) {
    const message = "AI provider is in stub mode — nothing was extracted.";
    await failRun(message);
    return { ok: false, error: message };
  }

  // Dedup against earlier candidates for this artifact (any decision)
  // and the tenant's curated entries.
  const priorCandidates = await db
    .select({ kind: knowledgeExtractionCandidates.kind, title: knowledgeExtractionCandidates.title })
    .from(knowledgeExtractionCandidates)
    .where(
      and(
        eq(knowledgeExtractionCandidates.organizationId, organizationId),
        eq(knowledgeExtractionCandidates.artifactId, artifact.id),
      ),
    );
  const priorEntries = await db
    .select({ kind: knowledgeEntries.kind, title: knowledgeEntries.title })
    .from(knowledgeEntries)
    .where(
      and(
        eq(knowledgeEntries.organizationId, organizationId),
        isNull(knowledgeEntries.archivedAt),
      ),
    )
    .limit(ENTRY_KEY_LIMIT);
  const existingKeys = [...priorCandidates, ...priorEntries].map((r) =>
    candidateKey(r.kind, r.title),
  );
  const { kept, skipped } = dedupCandidates(aiRes.candidates, existingKeys);

  // Materialize candidates. Sequential per Neon-pgbouncer rule.
  for (const c of kept) {
    await db.insert(knowledgeExtractionCandidates).values({
      organizationId,
      runId: run.id,
      artifactId: artifact.id,
      kind: c.kind as KnowledgeKind,
      title: c.title,
      body: c.body,
      tags: c.tags,
      metadata: c.metadata ?? {},
      sourceExcerpt: c.sourceExcerpt,
    });
  }

  await db
    .update(knowledgeExtractionRuns)
    .set({
      status: "completed",
      candidateCount: kept.length,
      provider: aiRes.provider,
      model: aiRes.model,
      finishedAt: new Date(),
      errorMessage: skipped > 0 ? `${skipped} duplicate candidate(s) skipped` : "",
    })
    .where(
      and(
        eq(knowledgeExtractionRuns.organizationId, organizationId),
        eq(knowledgeExtractionRuns.id, run.id),
      ),
    );

  return {
    ok: true,
    runId: run.id,
    candidateCount: kept.length,
    skippedDuplicates: skipped,
    stubbed: aiRes.stubbed,
    provider: aiRes.provider,
    model: aiRes.model,
  };
}
