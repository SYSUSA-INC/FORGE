"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  solicitationCapabilityMatrices,
  solicitationDocuments,
  solicitationQuestionSets,
  solicitationReviews,
  solicitations,
  type CapabilityMatrixCell,
  type SolicitationQuestion,
  type SolicitationReviewResult,
  type SolicitationReviewStatus,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { selectKnowledgeForMatrix } from "@/lib/matrix-knowledge";
import { enforceRateLimit } from "@/lib/rate-limit";
import type { ReviewedRequirement } from "@/lib/requirement-review";
import { buildReviewBasis } from "@/lib/review-basis";
import { mergeLmStructures } from "@/lib/solicitation-lm";
import {
  aiRunCapabilityMatrix,
  aiRunQuestionGenerator,
  aiRunSolicitationReview,
} from "@/lib/solicitation-ai-review";
import { log } from "@/lib/log";

// ────────────────────────────────────────────────────────────────────
// Status — drives the UI button gating.
// ────────────────────────────────────────────────────────────────────

export type ReviewStatusSnapshot = {
  reviewStatus: SolicitationReviewStatus | "none";
  reviewError: string;
  reviewCompletedAt: string | null;
  reviewStubbed: boolean;
  reviewModel: string;
  hasMatrix: boolean;
  matrixStubbed: boolean;
  matrixCreatedAt: string | null;
  hasQuestions: boolean;
  questionsStubbed: boolean;
  questionsCreatedAt: string | null;
};

export async function getReviewStatusAction(
  solicitationId: string,
): Promise<ReviewStatusSnapshot> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  // Confirm this solicitation belongs to the caller's org. Without
  // this check a hand-typed UUID could read another tenant's review.
  const [s] = await db
    .select({ id: solicitations.id })
    .from(solicitations)
    .where(
      and(
        eq(solicitations.id, solicitationId),
        eq(solicitations.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!s) {
    return {
      reviewStatus: "none",
      reviewError: "",
      reviewCompletedAt: null,
      reviewStubbed: false,
      reviewModel: "",
      hasMatrix: false,
      matrixStubbed: false,
      matrixCreatedAt: null,
      hasQuestions: false,
      questionsStubbed: false,
      questionsCreatedAt: null,
    };
  }

  const [review] = await db
    .select()
    .from(solicitationReviews)
    .where(
      and(
        eq(solicitationReviews.solicitationId, solicitationId),
        eq(solicitationReviews.organizationId, organizationId),
      ),
    )
    .limit(1);

  const [matrix] = await db
    .select({
      stubbed: solicitationCapabilityMatrices.stubbed,
      createdAt: solicitationCapabilityMatrices.createdAt,
    })
    .from(solicitationCapabilityMatrices)
    .where(
      and(
        eq(solicitationCapabilityMatrices.solicitationId, solicitationId),
        eq(
          solicitationCapabilityMatrices.organizationId,
          organizationId,
        ),
      ),
    )
    .limit(1);

  const [questions] = await db
    .select({
      stubbed: solicitationQuestionSets.stubbed,
      createdAt: solicitationQuestionSets.createdAt,
    })
    .from(solicitationQuestionSets)
    .where(
      and(
        eq(solicitationQuestionSets.solicitationId, solicitationId),
        eq(solicitationQuestionSets.organizationId, organizationId),
      ),
    )
    .limit(1);

  return {
    reviewStatus: review?.status ?? "none",
    reviewError: review?.error ?? "",
    reviewCompletedAt: review?.completedAt
      ? review.completedAt.toISOString()
      : null,
    reviewStubbed: review?.stubbed ?? false,
    reviewModel: review?.model ?? "",
    hasMatrix: !!matrix,
    matrixStubbed: matrix?.stubbed ?? false,
    matrixCreatedAt: matrix?.createdAt
      ? matrix.createdAt.toISOString()
      : null,
    hasQuestions: !!questions,
    questionsStubbed: questions?.stubbed ?? false,
    questionsCreatedAt: questions?.createdAt
      ? questions.createdAt.toISOString()
      : null,
  };
}

// ────────────────────────────────────────────────────────────────────
// 1. Initiate review
// ────────────────────────────────────────────────────────────────────

export type RunReviewResult =
  | {
      ok: true;
      reviewId: string;
      stubbed: boolean;
      model: string;
      requirementCount: number;
    }
  | { ok: false; error: string };

/**
 * Initiate (or re-run) the deep AI document review for a
 * solicitation. Rate-limited per solicitation. Idempotent — re-runs
 * UPSERT the review row + cascade-invalidate the matrix and
 * question_set so they reflect the new requirements list.
 */
export async function runSolicitationReviewAction(
  solicitationId: string,
): Promise<RunReviewResult> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  // Tenant boundary check + load the parse the review builds on.
  const [doc] = await db
    .select({
      id: solicitations.id,
      title: solicitations.title,
      fileName: solicitations.fileName,
      rawText: solicitations.rawText,
      parseStatus: solicitations.parseStatus,
      setAside: solicitations.setAside,
      extractedRequirements: solicitations.extractedRequirements,
      lmStructure: solicitations.lmStructure,
      sectionLSummary: solicitations.sectionLSummary,
      sectionMSummary: solicitations.sectionMSummary,
    })
    .from(solicitations)
    .where(
      and(
        eq(solicitations.id, solicitationId),
        eq(solicitations.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!doc) return { ok: false, error: "Solicitation not found." };

  // BL-STAB-9 — the review builds on the parse's requirements and
  // Sections L and M, so it waits for a finished parse.
  if (doc.parseStatus !== "parsed" || !doc.rawText.trim()) {
    return {
      ok: false,
      error:
        doc.parseStatus === "failed"
          ? "The document's parse failed, and the review builds on it. Fix the parse (Re-parse) first."
          : "The document is still being parsed. The review builds on the parsed requirements; try again when the parse finishes.",
    };
  }

  // Sections L and M: the solicitation's own, else a companion document's
  // (the same merge the solicitation page shows).
  const companionLm = await db
    .select({ lm: solicitationDocuments.lmStructure })
    .from(solicitationDocuments)
    .where(and(eq(solicitationDocuments.solicitationId, solicitationId), eq(solicitationDocuments.organizationId, organizationId)))
    .orderBy(asc(solicitationDocuments.sortOrder), asc(solicitationDocuments.createdAt));
  const basis = buildReviewBasis({
    requirements: doc.extractedRequirements as ReviewedRequirement[],
    lm: mergeLmStructures([doc.lmStructure, ...companionLm.map((d) => d.lm)]),
    sectionLSummary: doc.sectionLSummary,
    sectionMSummary: doc.sectionMSummary,
  });

  const limit = await enforceRateLimit({
    key: `solicitation-review:${solicitationId}`,
    limit: 5,
    windowSeconds: 3600,
  });
  if (!limit.ok) {
    return {
      ok: false,
      error: `Review limit reached. Try again in ${Math.ceil(limit.retryAfter / 60)} minutes.`,
    };
  }

  // Mark the review running (UPSERT via existing-row check) so the
  // UI can reflect "running" even if the AI call takes a while.
  const now = new Date();
  const [existing] = await db
    .select({ id: solicitationReviews.id })
    .from(solicitationReviews)
    .where(
      and(
        eq(solicitationReviews.solicitationId, solicitationId),
        eq(solicitationReviews.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(solicitationReviews)
      .set({
        status: "running",
        error: "",
        updatedAt: now,
      })
      .where(and(eq(solicitationReviews.organizationId, organizationId), eq(solicitationReviews.id, existing.id)));
  } else {
    await db.insert(solicitationReviews).values({
      organizationId,
      solicitationId,
      status: "running",
      createdByUserId: actor.id,
    });
  }

  revalidatePath(`/solicitations/${solicitationId}`);

  // Fire the AI call.
  const result = await aiRunSolicitationReview({
    organizationId,
    title: doc.title,
    fileName: doc.fileName,
    rawText: doc.rawText,
    basis: { requirementCount: basis.requirements.length, factors: basis.evaluationFactors.map((f) => f.name) },
  });

  const completedAt = new Date();

  if (!result.ok) {
    await db
      .update(solicitationReviews)
      .set({
        status: "failed",
        error: result.error.slice(0, 1000),
        completedAt,
        updatedAt: completedAt,
      })
      .where(
        and(
          eq(solicitationReviews.solicitationId, solicitationId),
          eq(solicitationReviews.organizationId, organizationId),
        ),
      );
    revalidatePath(`/solicitations/${solicitationId}`);
    return { ok: false, error: result.error };
  }

  // BL-STAB-9 — the requirements, Sections L/M and evaluation factors are
  // the parse's; the AI contributed the judgement.
  const persistedResult: SolicitationReviewResult = {
    summary: result.data.summary,
    sectionL: basis.sectionL,
    sectionM: basis.sectionM,
    requirements: basis.requirements,
    capabilityAreas: basis.capabilityAreas,
    evaluationFactors: basis.evaluationFactors,
    periodOfPerformance: result.data.periodOfPerformance,
    placeOfPerformance: result.data.placeOfPerformance,
    setAside: result.data.setAside || doc.setAside,
    mandatoryCertifications: result.data.mandatoryCertifications,
    flaggedQuestions: result.data.flaggedQuestions,
    basis: { source: "parse", hash: basis.hash, requirementCount: basis.requirements.length },
  };

  await db
    .update(solicitationReviews)
    .set({
      status: "complete",
      result: persistedResult,
      error: "",
      model: `${result.provider}:${result.model}`,
      stubbed: result.stubbed,
      completedAt,
      updatedAt: completedAt,
    })
    .where(
      and(
        eq(solicitationReviews.solicitationId, solicitationId),
        eq(solicitationReviews.organizationId, organizationId),
      ),
    );

  // BL-STAB-9 — the matrix and questions are kept: a requirement keeps
  // its id across re-runs, so the matrix's cells still apply, and
  // requirements new to this review show as not yet scored ("Score
  // remaining"). Cells for requirements no longer listed are not shown.

  // Look up the now-canonical row to return its id.
  const [row] = await db
    .select({ id: solicitationReviews.id })
    .from(solicitationReviews)
    .where(
      and(
        eq(solicitationReviews.solicitationId, solicitationId),
        eq(solicitationReviews.organizationId, organizationId),
      ),
    )
    .limit(1);

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "solicitation.review.run",
    resourceType: "solicitation",
    resourceId: solicitationId,
    metadata: {
      reviewId: row!.id,
      requirementCount: basis.requirements.length,
      basisHash: basis.hash,
      stubbed: result.stubbed,
    },
  });

  revalidatePath(`/solicitations/${solicitationId}`);
  log.info("[runSolicitationReviewAction]", "complete", {
    solicitationId,
    requirementCount: basis.requirements.length,
    stubbed: result.stubbed,
  });

  return {
    ok: true,
    reviewId: row!.id,
    stubbed: result.stubbed,
    model: `${result.provider}:${result.model}`,
    requirementCount: basis.requirements.length,
  };
}

// ────────────────────────────────────────────────────────────────────
// 2. Capability matrix (gated on completed review)
// ────────────────────────────────────────────────────────────────────

export type RunCapabilityMatrixResult =
  | {
      ok: true;
      matrixId: string;
      cellCount: number;
      /** Requirements still without a score (time budget or a failed window); "Score remaining" finishes them. */
      unscoredCount: number;
      pwinLow: number;
      pwinHigh: number;
      stubbed: boolean;
    }
  | { ok: false; error: string };

/** BL-STAB-9 — windows are started for this long; the rest wait for "Score remaining". */
const MATRIX_TIME_BUDGET_MS = 170_000;

/**
 * Build (or finish) the capability matrix: every requirement of the
 * review scored against the company's knowledge, a window at a time.
 * Requirements that already have a cell keep it unless `rebuild` is set,
 * so a run that stopped part-way is finished by the next.
 */
export async function runCapabilityMatrixAction(
  solicitationId: string,
  options?: { rebuild?: boolean },
): Promise<RunCapabilityMatrixResult> {
  const startedAt = Date.now();
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const rebuild = options?.rebuild === true;

  const [doc] = await db
    .select({
      id: solicitations.id,
      title: solicitations.title,
      agency: solicitations.agency,
      setAside: solicitations.setAside,
    })
    .from(solicitations)
    .where(
      and(
        eq(solicitations.id, solicitationId),
        eq(solicitations.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!doc) return { ok: false, error: "Solicitation not found." };

  // Gate: review must be complete.
  const [review] = await db
    .select()
    .from(solicitationReviews)
    .where(
      and(
        eq(solicitationReviews.solicitationId, solicitationId),
        eq(solicitationReviews.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!review || review.status !== "complete") {
    return {
      ok: false,
      error: "Run the document review first — the matrix builds on top of it.",
    };
  }
  const reviewResult = review.result;
  const requirements = reviewResult.requirements ?? [];
  if (requirements.length === 0) {
    return {
      ok: false,
      error:
        "The parse found no requirements in this document, so there is nothing to score. Check the requirements list (or add the ones it missed), then re-run the review.",
    };
  }

  const limit = await enforceRateLimit({
    key: `solicitation-matrix:${solicitationId}`,
    limit: 10,
    windowSeconds: 3600,
  });
  if (!limit.ok) {
    return {
      ok: false,
      error: `Matrix limit reached. Try again in ${Math.ceil(limit.retryAfter / 60)} minutes.`,
    };
  }

  const [existing] = await db
    .select({ id: solicitationCapabilityMatrices.id, cells: solicitationCapabilityMatrices.cells })
    .from(solicitationCapabilityMatrices)
    .where(
      and(
        eq(solicitationCapabilityMatrices.solicitationId, solicitationId),
        eq(solicitationCapabilityMatrices.organizationId, organizationId),
      ),
    )
    .limit(1);

  // BL-AIP-1 — score against the knowledge the Brain ranks as relevant to
  // this solicitation. The prompt shows at most 60 entries; until now the
  // first 60 BY TITLE were sent, so for a larger Brain the matrix scored
  // against an arbitrary alphabetical slice.
  const knowledge = await selectKnowledgeForMatrix({
    organizationId,
    query: [
      `Solicitation: ${doc.title}`,
      doc.agency ? `Agency: ${doc.agency}` : "",
      doc.setAside ? `Set-aside: ${doc.setAside}` : "",
      ...requirements.slice(0, 40).map((r) => String(r.text ?? "").slice(0, 200)),
    ]
      .filter(Boolean)
      .join("\n"),
  });

  const result = await aiRunCapabilityMatrix({
    organizationId,
    solicitationTitle: doc.title,
    agency: doc.agency,
    setAside: doc.setAside,
    requirements,
    factors: reviewResult.evaluationFactors ?? [],
    knowledgeEntries: knowledge.entries,
    existing: rebuild ? [] : (existing?.cells ?? []),
    stopAt: startedAt + MATRIX_TIME_BUDGET_MS,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const cells: CapabilityMatrixCell[] = result.data.cells;
  // Clamp + sort PWin recommendation.
  const low = clamp(result.data.pwinRecommendationLow, 0, 100);
  const high = clamp(result.data.pwinRecommendationHigh, 0, 100);
  const [pwinLow, pwinHigh] = low <= high ? [low, high] : [high, low];

  const now = new Date();
  let matrixId: string;
  if (existing) {
    await db
      .update(solicitationCapabilityMatrices)
      .set({
        cells,
        pwinRecommendationLow: pwinLow,
        pwinRecommendationHigh: pwinHigh,
        model: `${result.provider}:${result.model}`,
        stubbed: result.stubbed,
        solicitationReviewId: review.id,
        updatedAt: now,
      })
      .where(and(eq(solicitationCapabilityMatrices.organizationId, organizationId), eq(solicitationCapabilityMatrices.id, existing.id)));
    matrixId = existing.id;
  } else {
    const [row] = await db
      .insert(solicitationCapabilityMatrices)
      .values({
        organizationId,
        solicitationId,
        solicitationReviewId: review.id,
        cells,
        pwinRecommendationLow: pwinLow,
        pwinRecommendationHigh: pwinHigh,
        model: `${result.provider}:${result.model}`,
        stubbed: result.stubbed,
        createdByUserId: actor.id,
      })
      .returning({ id: solicitationCapabilityMatrices.id });
    if (!row) return { ok: false, error: "Could not save matrix." };
    matrixId = row.id;
  }

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "solicitation.matrix.run",
    resourceType: "solicitation",
    resourceId: solicitationId,
    metadata: {
      matrixId,
      cellCount: cells.length,
      unscoredCount: result.data.unscored.length,
      rebuild,
      pwinLow,
      pwinHigh,
      stubbed: result.stubbed,
    },
  });

  revalidatePath(`/solicitations/${solicitationId}`);
  return {
    ok: true,
    matrixId,
    cellCount: cells.length,
    unscoredCount: result.data.unscored.length,
    pwinLow,
    pwinHigh,
    stubbed: result.stubbed,
  };
}

// ────────────────────────────────────────────────────────────────────
// 3. Question generator (gated on completed review)
// ────────────────────────────────────────────────────────────────────

export type RunQuestionGeneratorResult =
  | {
      ok: true;
      questionSetId: string;
      questionCount: number;
      stubbed: boolean;
    }
  | { ok: false; error: string };

export async function runQuestionGeneratorAction(
  solicitationId: string,
): Promise<RunQuestionGeneratorResult> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [doc] = await db
    .select({
      id: solicitations.id,
      title: solicitations.title,
      agency: solicitations.agency,
    })
    .from(solicitations)
    .where(
      and(
        eq(solicitations.id, solicitationId),
        eq(solicitations.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!doc) return { ok: false, error: "Solicitation not found." };

  const [review] = await db
    .select()
    .from(solicitationReviews)
    .where(
      and(
        eq(solicitationReviews.solicitationId, solicitationId),
        eq(solicitationReviews.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!review || review.status !== "complete") {
    return {
      ok: false,
      error: "Run the document review first — the question generator builds on top of it.",
    };
  }
  const reviewResult = review.result;

  const limit = await enforceRateLimit({
    key: `solicitation-questions:${solicitationId}`,
    limit: 10,
    windowSeconds: 3600,
  });
  if (!limit.ok) {
    return {
      ok: false,
      error: `Question generator limit reached. Try again in ${Math.ceil(limit.retryAfter / 60)} minutes.`,
    };
  }

  const result = await aiRunQuestionGenerator({
    organizationId,
    solicitationTitle: doc.title,
    agency: doc.agency,
    reviewSummary: reviewResult.summary,
    sectionL: reviewResult.sectionL,
    sectionM: reviewResult.sectionM,
    requirements: reviewResult.requirements,
    evaluationFactors: reviewResult.evaluationFactors,
    flaggedQuestions: reviewResult.flaggedQuestions,
  });
  if (!result.ok) return { ok: false, error: result.error };

  const questions: SolicitationQuestion[] = result.data.questions;

  const now = new Date();
  const [existing] = await db
    .select({ id: solicitationQuestionSets.id })
    .from(solicitationQuestionSets)
    .where(
      and(
        eq(solicitationQuestionSets.solicitationId, solicitationId),
        eq(solicitationQuestionSets.organizationId, organizationId),
      ),
    )
    .limit(1);

  let questionSetId: string;
  if (existing) {
    await db
      .update(solicitationQuestionSets)
      .set({
        questions,
        model: `${result.provider}:${result.model}`,
        stubbed: result.stubbed,
        solicitationReviewId: review.id,
        updatedAt: now,
      })
      .where(and(eq(solicitationQuestionSets.organizationId, organizationId), eq(solicitationQuestionSets.id, existing.id)));
    questionSetId = existing.id;
  } else {
    const [row] = await db
      .insert(solicitationQuestionSets)
      .values({
        organizationId,
        solicitationId,
        solicitationReviewId: review.id,
        questions,
        model: `${result.provider}:${result.model}`,
        stubbed: result.stubbed,
        createdByUserId: actor.id,
      })
      .returning({ id: solicitationQuestionSets.id });
    if (!row) return { ok: false, error: "Could not save question set." };
    questionSetId = row.id;
  }

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "solicitation.questions.run",
    resourceType: "solicitation",
    resourceId: solicitationId,
    metadata: {
      questionSetId,
      questionCount: questions.length,
      stubbed: result.stubbed,
    },
  });

  revalidatePath(`/solicitations/${solicitationId}`);
  return {
    ok: true,
    questionSetId,
    questionCount: questions.length,
    stubbed: result.stubbed,
  };
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}
