import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import {
  solicitations,
  solicitationCapabilityMatrices,
  solicitationQuestionSets,
  solicitationReviews,
} from "@/db/schema";
import { Panel } from "@/components/ui/Panel";
import { OpportunityDocsAndAIClient } from "./OpportunityDocsAndAIClient";

/**
 * BL-23b — opportunity-mirror surface for BL-23's AI doc review.
 *
 * Mirrors the three-button workflow (Initiate Review / Capability
 * Matrix / Generate Questions) on the opportunity detail page,
 * scoped to every solicitation attached to the opportunity.
 *
 * Empty state when no linked solicitation. Per-doc rows with status
 * pills + compact three-button cluster + click-through to the full
 * solicitation detail page. Aggregate counts in the header when the
 * opportunity has 2+ linked solicitations.
 *
 * Data loaded server-side; actions fire from the client component
 * via the same `review-actions.ts` server actions used by the
 * primary solicitation surface — single source of truth.
 */
export async function OpportunityDocsAndAIPanel({
  opportunityId,
  organizationId,
}: {
  opportunityId: string;
  organizationId: string;
}) {
  // Solicitations linked to this opportunity.
  const linkedSolicitations = await db
    .select({
      id: solicitations.id,
      title: solicitations.title,
      fileName: solicitations.fileName,
      solicitationNumber: solicitations.solicitationNumber,
      parseStatus: solicitations.parseStatus,
      rawText: solicitations.rawText,
    })
    .from(solicitations)
    .where(
      and(
        eq(solicitations.opportunityId, opportunityId),
        eq(solicitations.organizationId, organizationId),
      ),
    )
    .orderBy(asc(solicitations.createdAt));

  if (linkedSolicitations.length === 0) {
    return (
      <Panel title="Documents & AI review" eyebrow="BL-23b">
        <p className="font-body text-[13px] leading-relaxed text-muted">
          No solicitations are linked to this opportunity yet. Upload a
          solicitation document and link it here to enable AI document
          review, capability matrix scoring, and clarification question
          generation.
        </p>
        <div className="mt-3">
          <Link
            href="/solicitations/new"
            className="aur-btn aur-btn-primary text-[12px]"
          >
            Upload a solicitation →
          </Link>
        </div>
      </Panel>
    );
  }

  // Load review / matrix / questions state for each solicitation in
  // parallel. Stays under the isolation gate (every query scoped by
  // organizationId).
  const solicitationIds = linkedSolicitations.map((s) => s.id);
  const [reviewRows, matrixRows, questionRows] = await Promise.all([
    db
      .select({
        solicitationId: solicitationReviews.solicitationId,
        status: solicitationReviews.status,
        stubbed: solicitationReviews.stubbed,
        completedAt: solicitationReviews.completedAt,
      })
      .from(solicitationReviews)
      .where(
        and(
          eq(solicitationReviews.organizationId, organizationId),
          solicitationIds.length === 1
            ? eq(solicitationReviews.solicitationId, solicitationIds[0]!)
            : eq(solicitationReviews.organizationId, organizationId),
        ),
      ),
    db
      .select({
        solicitationId: solicitationCapabilityMatrices.solicitationId,
        cellCount: solicitationCapabilityMatrices.cells,
        stubbed: solicitationCapabilityMatrices.stubbed,
      })
      .from(solicitationCapabilityMatrices)
      .where(eq(solicitationCapabilityMatrices.organizationId, organizationId)),
    db
      .select({
        solicitationId: solicitationQuestionSets.solicitationId,
        questionsBlob: solicitationQuestionSets.questions,
        stubbed: solicitationQuestionSets.stubbed,
      })
      .from(solicitationQuestionSets)
      .where(eq(solicitationQuestionSets.organizationId, organizationId)),
  ]);

  // Index by solicitation id for O(1) join in render.
  const reviewById = new Map(
    reviewRows
      .filter((r) => solicitationIds.includes(r.solicitationId))
      .map((r) => [r.solicitationId, r]),
  );
  const matrixById = new Map(
    matrixRows
      .filter((r) => solicitationIds.includes(r.solicitationId))
      .map((r) => [r.solicitationId, r]),
  );
  const questionById = new Map(
    questionRows
      .filter((r) => solicitationIds.includes(r.solicitationId))
      .map((r) => [r.solicitationId, r]),
  );

  const rows = linkedSolicitations.map((s) => {
    const review = reviewById.get(s.id) ?? null;
    const matrix = matrixById.get(s.id) ?? null;
    const question = questionById.get(s.id) ?? null;
    return {
      id: s.id,
      title: s.title || s.fileName || "Untitled solicitation",
      solicitationNumber: s.solicitationNumber,
      hasRawText: !!s.rawText && s.rawText.length > 0,
      parseStatus: s.parseStatus,
      reviewStatus: (review?.status ?? "none") as
        | "none"
        | "pending"
        | "running"
        | "complete"
        | "failed",
      reviewComplete: review?.status === "complete",
      reviewStubbed: !!review?.stubbed,
      matrixCount: Array.isArray(matrix?.cellCount)
        ? matrix!.cellCount.length
        : 0,
      matrixStubbed: !!matrix?.stubbed,
      questionCount: Array.isArray(question?.questionsBlob)
        ? question!.questionsBlob.length
        : 0,
      questionStubbed: !!question?.stubbed,
    };
  });

  const reviewsComplete = rows.filter((r) => r.reviewComplete).length;
  const matricesBuilt = rows.filter((r) => r.matrixCount > 0).length;
  const questionsGenerated = rows.filter((r) => r.questionCount > 0).length;

  return (
    <Panel
      title="Documents & AI review"
      eyebrow="BL-23b"
      actions={
        rows.length > 1 ? (
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
            {reviewsComplete}/{rows.length} reviews · {matricesBuilt}{" "}
            matrice{matricesBuilt === 1 ? "" : "s"} ·{" "}
            {questionsGenerated} question set
            {questionsGenerated === 1 ? "" : "s"}
          </div>
        ) : null
      }
    >
      <OpportunityDocsAndAIClient solicitations={rows} />
    </Panel>
  );
}
