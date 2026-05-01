/**
 * Phase 14b — section-level signals.
 *
 * For each section kind (executive_summary / technical / management /
 * past_performance / pricing / compliance), surface the connection
 * between color-team review verdicts and the final proposal outcome.
 *
 *   Q: Do our winning past-performance sections get higher reviewer
 *      pass rates than our losing ones?
 *
 * Read-only aggregation; no schema changes. Joins:
 *
 *   proposal_section
 *     ⋈ proposal_review_assignment (per-section verdicts during review)
 *     ⋈ proposal_review (review color, status)
 *     ⋈ proposal (organization scope)
 *     ⋈ proposal_outcome (won / lost / no_bid / withdrawn)
 *
 * Only "complete" reviews count, so in-progress assignments don't
 * skew the numbers.
 */
import "server-only";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import {
  proposalOutcomes,
  proposalReviewAssignments,
  proposalReviews,
  proposalSections,
  proposals,
  type ProposalOutcomeType,
  type ProposalSectionKind,
  type ReviewVerdict,
} from "@/db/schema";

export type SectionSignalRow = {
  kind: ProposalSectionKind;
  // Counts of (assignment, outcome) pairs that contribute to each
  // bucket. One assignment with three reviewers becomes three rows in
  // the join — that's intentional, since each reviewer is an
  // independent signal.
  totalSignals: number;
  byOutcome: Record<
    "won" | "lost" | "no_bid" | "withdrawn",
    {
      total: number;
      pass: number;
      conditional: number;
      fail: number;
      passRate: number; // 0..1, 0 when total=0
    }
  >;
};

const SECTION_KINDS: ProposalSectionKind[] = [
  "executive_summary",
  "technical",
  "management",
  "past_performance",
  "pricing",
  "compliance",
];

const OUTCOMES_TO_TRACK: ProposalOutcomeType[] = [
  "won",
  "lost",
  "no_bid",
  "withdrawn",
];

function emptyBucket() {
  return { total: 0, pass: 0, conditional: 0, fail: 0, passRate: 0 };
}

export async function getSectionSignals(
  organizationId: string,
): Promise<{
  rows: SectionSignalRow[];
  totalProposalsWithOutcome: number;
  totalReviewedSections: number;
}> {
  // Pull every per-section verdict for proposals in this org that
  // have a recorded outcome. Group + tally in JS — the data volume is
  // small (one row per section × per reviewer), and computing in JS
  // keeps the query trivially Drizzle-typed.
  const rows = await db
    .select({
      sectionKind: proposalSections.kind,
      verdict: proposalReviewAssignments.verdict,
      reviewStatus: proposalReviews.status,
      outcomeType: proposalOutcomes.outcomeType,
    })
    .from(proposalReviewAssignments)
    .innerJoin(
      proposalReviews,
      eq(proposalReviews.id, proposalReviewAssignments.reviewId),
    )
    .innerJoin(
      proposalSections,
      eq(proposalSections.id, proposalReviewAssignments.sectionId),
    )
    .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
    .innerJoin(
      proposalOutcomes,
      eq(proposalOutcomes.proposalId, proposalReviews.proposalId),
    )
    .where(
      and(
        eq(proposals.organizationId, organizationId),
        isNotNull(proposalReviewAssignments.verdict),
        eq(proposalReviews.status, "complete"),
        inArray(proposalOutcomes.outcomeType, OUTCOMES_TO_TRACK),
      ),
    );

  const result: Record<ProposalSectionKind, SectionSignalRow> = Object.create(
    null,
  );
  for (const k of SECTION_KINDS) {
    result[k] = {
      kind: k,
      totalSignals: 0,
      byOutcome: {
        won: emptyBucket(),
        lost: emptyBucket(),
        no_bid: emptyBucket(),
        withdrawn: emptyBucket(),
      },
    };
  }

  for (const r of rows) {
    if (!r.verdict) continue;
    const row = result[r.sectionKind];
    if (!row) continue;
    row.totalSignals += 1;
    const bucket = row.byOutcome[r.outcomeType as keyof typeof row.byOutcome];
    if (!bucket) continue;
    bucket.total += 1;
    bucket[r.verdict as ReviewVerdict] += 1;
  }

  // Compute pass rates.
  for (const k of SECTION_KINDS) {
    const row = result[k];
    for (const o of OUTCOMES_TO_TRACK) {
      const b = row.byOutcome[o];
      b.passRate = b.total > 0 ? b.pass / b.total : 0;
    }
  }

  // For the secondary stats: total distinct proposals with outcomes,
  // and total distinct sections that received any verdict.
  const proposalsWithOutcomeRows = await db
    .selectDistinct({ id: proposalOutcomes.proposalId })
    .from(proposalOutcomes)
    .innerJoin(proposals, eq(proposals.id, proposalOutcomes.proposalId))
    .where(eq(proposals.organizationId, organizationId));

  const reviewedSectionsRows = await db
    .selectDistinct({ id: proposalSections.id })
    .from(proposalSections)
    .innerJoin(
      proposalReviewAssignments,
      eq(proposalReviewAssignments.sectionId, proposalSections.id),
    )
    .innerJoin(
      proposalReviews,
      eq(proposalReviews.id, proposalReviewAssignments.reviewId),
    )
    .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
    .where(
      and(
        eq(proposals.organizationId, organizationId),
        isNotNull(proposalReviewAssignments.verdict),
      ),
    );

  return {
    rows: SECTION_KINDS.map((k) => result[k]),
    totalProposalsWithOutcome: proposalsWithOutcomeRows.length,
    totalReviewedSections: reviewedSectionsRows.length,
  };
}
