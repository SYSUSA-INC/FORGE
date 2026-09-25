"use server";

import { and, asc, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  knowledgeArtifacts,
  knowledgeEntries,
  knowledgeExtractionCandidates,
  knowledgeExtractionRuns,
  type KnowledgeExtractionDecision,
  type KnowledgeKind,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { embedKnowledgeEntry } from "@/lib/knowledge-entry-embed";
import { runKnowledgeExtraction } from "@/lib/knowledge-extraction";
import { scoreKnowledgeEntry } from "@/lib/knowledge-quality";
import { log } from "@/lib/log";

export type StartExtractionResult =
  | {
      ok: true;
      runId: string;
      candidateCount: number;
      stubbed: boolean;
    }
  | { ok: false; error: string };

/**
 * Run a Brain extraction pass over an artifact. Inserts a new
 * extraction_run row, calls the AI gateway, materializes each
 * proposed candidate as a knowledge_extraction_candidate row with
 * decision=pending. Returns the run id + count.
 */
export async function startKnowledgeExtractionAction(
  artifactId: string,
): Promise<StartExtractionResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  // BL-AIP-4 — the run itself (with candidate de-duplication) lives in
  // src/lib/knowledge-extraction.ts so the brain-index cron shares it.
  const res = await runKnowledgeExtraction({
    organizationId,
    artifactId,
    startedByUserId: user.id,
  });
  if (!res.ok) return { ok: false, error: res.error };

  await recordAudit({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: "knowledge_extraction.run",
    resourceType: "knowledge_extraction_run",
    resourceId: res.runId,
    metadata: {
      artifactId,
      candidateCount: res.candidateCount,
      skippedDuplicates: res.skippedDuplicates,
      provider: res.provider,
      model: res.model,
      stubbed: res.stubbed,
    },
  });

  revalidatePath("/knowledge-base");
  revalidatePath("/knowledge-base/import");
  revalidatePath(`/knowledge-base/import/${artifactId}`);

  return {
    ok: true,
    runId: res.runId,
    candidateCount: res.candidateCount,
    stubbed: res.stubbed,
  };
}

export type CandidateRow = {
  id: string;
  kind: KnowledgeKind;
  title: string;
  body: string;
  tags: string[];
  sourceExcerpt: string;
  decision: KnowledgeExtractionDecision;
  decidedAt: string | null;
  promotedEntryId: string | null;
  runId: string;
  createdAt: string;
};

export type RunRow = {
  id: string;
  status: string;
  candidateCount: number;
  provider: string;
  model: string;
  errorMessage: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export async function getArtifactWithCandidatesAction(artifactId: string) {
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
  if (!artifact) return null;

  const candidates = await db
    .select()
    .from(knowledgeExtractionCandidates)
    .where(
      and(
        eq(knowledgeExtractionCandidates.artifactId, artifactId),
        eq(knowledgeExtractionCandidates.organizationId, organizationId),
      ),
    )
    .orderBy(asc(knowledgeExtractionCandidates.createdAt));

  const runs = await db
    .select()
    .from(knowledgeExtractionRuns)
    .where(
      and(
        eq(knowledgeExtractionRuns.artifactId, artifactId),
        eq(knowledgeExtractionRuns.organizationId, organizationId),
      ),
    )
    .orderBy(desc(knowledgeExtractionRuns.createdAt))
    .limit(20);

  return {
    artifact,
    candidates: candidates.map<CandidateRow>((c) => ({
      id: c.id,
      kind: c.kind,
      title: c.title,
      body: c.body,
      tags: c.tags ?? [],
      sourceExcerpt: c.sourceExcerpt,
      decision: c.decision,
      decidedAt: c.decidedAt ? c.decidedAt.toISOString() : null,
      promotedEntryId: c.promotedEntryId,
      runId: c.runId,
      createdAt: c.createdAt.toISOString(),
    })),
    runs: runs.map<RunRow>((r) => ({
      id: r.id,
      status: r.status,
      candidateCount: r.candidateCount,
      provider: r.provider,
      model: r.model,
      errorMessage: r.errorMessage,
      startedAt: r.startedAt ? r.startedAt.toISOString() : null,
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    })),
  };
}

export type ApproveResult =
  | { ok: true; entryId: string }
  | { ok: false; error: string };

/**
 * Approve a candidate → create a knowledge_entry row and link it back
 * to the candidate via promoted_entry_id. Idempotent: returns the
 * existing entry id if already approved.
 */
export async function approveCandidateAction(
  candidateId: string,
  patch?: { title?: string; body?: string; tags?: string[] },
): Promise<ApproveResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [c] = await db
    .select()
    .from(knowledgeExtractionCandidates)
    .where(
      and(
        eq(knowledgeExtractionCandidates.id, candidateId),
        eq(knowledgeExtractionCandidates.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!c) return { ok: false, error: "Candidate not found." };

  if (c.decision === "approved" && c.promotedEntryId) {
    return { ok: true, entryId: c.promotedEntryId };
  }
  if (c.decision === "rejected") {
    return {
      ok: false,
      error: "Candidate is rejected — un-reject it first to approve.",
    };
  }

  const finalTitle = (patch?.title ?? c.title).trim().slice(0, 256);
  const finalBody = (patch?.body ?? c.body).trim().slice(0, 8000);
  const finalTags =
    patch?.tags !== undefined
      ? patch.tags
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 16)
      : (c.tags ?? []);

  if (!finalTitle || !finalBody) {
    return {
      ok: false,
      error: "Title and body are required before approving.",
    };
  }

  // BL-AIP-4 — the promoted entry inherits the source artifact's outcome
  // (won / lost …) so retrieval's outcome boost applies from day one, and
  // is quality-scored on creation like a manually authored entry.
  const [sourceArtifact] = await db
    .select({ outcomeLabel: knowledgeArtifacts.outcomeLabel })
    .from(knowledgeArtifacts)
    .where(
      and(
        eq(knowledgeArtifacts.id, c.artifactId),
        eq(knowledgeArtifacts.organizationId, organizationId),
      ),
    )
    .limit(1);
  const metadata = {
    ...(typeof c.metadata === "object" && c.metadata
      ? (c.metadata as Record<string, string | number | boolean>)
      : {}),
    sourceArtifactId: c.artifactId,
    sourceCandidateId: c.id,
    sourceRunId: c.runId,
  };
  const quality = scoreKnowledgeEntry({
    kind: c.kind,
    title: finalTitle,
    body: finalBody,
    tags: finalTags,
    metadata,
  });

  const [entry] = await db
    .insert(knowledgeEntries)
    .values({
      organizationId,
      kind: c.kind,
      title: finalTitle,
      body: finalBody,
      tags: finalTags,
      metadata,
      outcomeLabel: sourceArtifact?.outcomeLabel ?? "none",
      qualityScore: quality.score,
      qualityScoreFactors: quality.factors,
      qualityScoredAt: new Date(),
      createdByUserId: user.id,
    })
    .returning({ id: knowledgeEntries.id });
  if (!entry) return { ok: false, error: "Could not create knowledge entry." };

  await db
    .update(knowledgeExtractionCandidates)
    .set({
      decision: "approved",
      decidedByUserId: user.id,
      decidedAt: new Date(),
      promotedEntryId: entry.id,
      // Persist any patches the reviewer made before approving.
      title: finalTitle,
      body: finalBody,
      tags: finalTags,
      updatedAt: new Date(),
    })
    .where(eq(knowledgeExtractionCandidates.id, c.id));

  // Embed the new entry so Brain Suggest can rank it via real cosine
  // similarity. Best-effort: failures don't block the approval — the
  // backfill action can fix it later.
  // The helper returns { ok: false } rather than throwing, so the old
  // `.catch` never saw a failure; check the result explicitly.
  const embedded = await embedKnowledgeEntry(
    organizationId,
    entry.id,
    finalTitle,
    finalBody,
  ).catch((err) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }));
  if (!embedded.ok) {
    log.warn("[approveCandidateAction]", "embed failed (non-fatal)", {
      entryId: entry.id,
      error: embedded.error,
    });
  }

  await recordAudit({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: "knowledge_extraction.promote",
    resourceType: "knowledge_extraction_candidate",
    resourceId: c.id,
    metadata: {
      entryId: entry.id,
      artifactId: c.artifactId,
      runId: c.runId,
      kind: c.kind,
    },
  });

  revalidatePath("/knowledge-base");
  revalidatePath(`/knowledge-base/import/${c.artifactId}`);
  return { ok: true, entryId: entry.id };
}

export async function rejectCandidateAction(
  candidateId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  await db
    .update(knowledgeExtractionCandidates)
    .set({
      decision: "rejected",
      decidedByUserId: user.id,
      decidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(knowledgeExtractionCandidates.id, candidateId),
        eq(knowledgeExtractionCandidates.organizationId, organizationId),
      ),
    );

  await recordAudit({
    organizationId,
    actor: { userId: user.id, email: user.email },
    action: "knowledge_extraction.dismiss",
    resourceType: "knowledge_extraction_candidate",
    resourceId: candidateId,
  });

  revalidatePath("/knowledge-base");
  return { ok: true };
}

/**
 * Re-open a rejected or approved candidate (e.g. user wants to undo).
 * Doesn't delete a promoted entry — that's a separate action.
 */
export async function resetCandidateAction(
  candidateId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  await db
    .update(knowledgeExtractionCandidates)
    .set({
      decision: "pending",
      decidedByUserId: null,
      decidedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(knowledgeExtractionCandidates.id, candidateId),
        eq(knowledgeExtractionCandidates.organizationId, organizationId),
      ),
    );

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "knowledge_extraction.reset",
    resourceType: "knowledge_extraction_candidate",
    resourceId: candidateId,
  });

  return { ok: true };
}

/**
 * Approve every pending candidate from the latest run for an
 * artifact. Useful when the reviewer trusts the run en masse.
 */
export async function approveAllPendingForArtifactAction(
  artifactId: string,
): Promise<{ ok: true; approved: number } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const pending = await db
    .select({ id: knowledgeExtractionCandidates.id })
    .from(knowledgeExtractionCandidates)
    .where(
      and(
        eq(knowledgeExtractionCandidates.artifactId, artifactId),
        eq(knowledgeExtractionCandidates.organizationId, organizationId),
        eq(knowledgeExtractionCandidates.decision, "pending"),
      ),
    );

  let approved = 0;
  for (const row of pending) {
    const r = await approveCandidateAction(row.id);
    if (r.ok) approved += 1;
  }

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "knowledge_extraction.bulk_promote",
    resourceType: "knowledge_artifact",
    resourceId: artifactId,
    metadata: { pending: pending.length, approved },
  });

  return { ok: true, approved };
}
