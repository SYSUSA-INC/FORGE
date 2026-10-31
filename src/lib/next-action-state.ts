import "server-only";

import { and, desc, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  aiBriefs,
  complianceItems,
  opportunities,
  opportunityCapabilityMatrices,
  opportunityCompetitors,
  opportunityEvaluations,
  opportunityLessons,
  proposalDebriefs,
  proposalOutcomes,
  proposalReviewComments,
  proposalReviews,
  proposalScanResults,
  proposalSections,
  proposals,
  solicitations,
} from "@/db/schema";
import { capabilityPwinFeature, computeCapabilityCoverage } from "@/lib/capability-coverage";
import { pendingSuggestions } from "@/lib/capability-suggestions";
import type { PursuitState } from "@/lib/next-actions";
import { canonicalStage } from "@/lib/opportunity-types";
import { WORDS_PER_PAGE } from "@/lib/page-budget";

/**
 * BL-NEXT-ACTION phase 5a — one pursuit's state in one pass, read by the
 * rules. Every query is scoped to the organization; tables without an
 * organization column are reached through the scoped opportunity or
 * proposal row.
 */
export type LoadedPursuit = { state: PursuitState; ownerUserId: string | null };

export async function loadPursuitState(organizationId: string, opportunityId: string): Promise<LoadedPursuit | null> {
  const [opp] = await db
    .select({ id: opportunities.id, stage: opportunities.stage, responseDueDate: opportunities.responseDueDate, awardDate: opportunities.awardDate, incumbent: opportunities.incumbent, ownerUserId: opportunities.ownerUserId })
    .from(opportunities)
    .where(and(eq(opportunities.organizationId, organizationId), eq(opportunities.id, opportunityId)))
    .limit(1);
  if (!opp) return null;

  const [sol, evaluation, matrix, brief, incumbent, proposal, lessons] = await Promise.all([
    db
      .select({ id: solicitations.id, parseStatus: solicitations.parseStatus })
      .from(solicitations)
      .where(and(eq(solicitations.organizationId, organizationId), eq(solicitations.opportunityId, opportunityId)))
      .orderBy(desc(solicitations.createdAt))
      .limit(1),
    db.select({ id: opportunityEvaluations.opportunityId }).from(opportunityEvaluations).where(eq(opportunityEvaluations.opportunityId, opportunityId)).limit(1),
    db
      .select({ questions: opportunityCapabilityMatrices.questions, answers: opportunityCapabilityMatrices.answers, suggestions: opportunityCapabilityMatrices.suggestions })
      .from(opportunityCapabilityMatrices)
      .where(and(eq(opportunityCapabilityMatrices.organizationId, organizationId), eq(opportunityCapabilityMatrices.opportunityId, opportunityId)))
      .limit(1),
    db
      .select({ id: aiBriefs.id })
      .from(aiBriefs)
      .where(and(eq(aiBriefs.organizationId, organizationId), eq(aiBriefs.opportunityId, opportunityId), eq(aiBriefs.kind, "pursuit")))
      .limit(1),
    db.select({ id: opportunityCompetitors.id }).from(opportunityCompetitors).where(and(eq(opportunityCompetitors.opportunityId, opportunityId), eq(opportunityCompetitors.isIncumbent, true))).limit(1),
    db
      .select({ id: proposals.id, stage: proposals.stage, submittedAt: proposals.submittedAt })
      .from(proposals)
      .where(and(eq(proposals.organizationId, organizationId), eq(proposals.opportunityId, opportunityId)))
      .orderBy(desc(proposals.updatedAt))
      .limit(1),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(opportunityLessons)
      .where(and(eq(opportunityLessons.organizationId, organizationId), eq(opportunityLessons.opportunityId, opportunityId), eq(opportunityLessons.status, "proposed"))),
  ]);

  let questionnaire: PursuitState["questionnaire"] = null;
  const m = matrix[0];
  if (m) {
    const coverage = computeCapabilityCoverage(m.questions, m.answers);
    questionnaire = {
      built: m.questions.length > 0,
      total: m.questions.length,
      answered: coverage.answered,
      suggestionsWaiting: pendingSuggestions(m.questions, m.answers, m.suggestions),
      counting: capabilityPwinFeature(coverage) !== null,
      partnerNeeded: coverage.partnerNeeded,
      shallGapsOpen: coverage.shallGapsOpen,
    };
  }

  const p = proposal[0];
  let proposalState: PursuitState["proposal"] = null;
  if (p) {
    const [sections, compliance, reviews, comments, scan, outcome, debrief] = await Promise.all([
      db.select({ status: proposalSections.status, wordCount: proposalSections.wordCount, pageLimit: proposalSections.pageLimit, updatedAt: proposalSections.updatedAt }).from(proposalSections).where(eq(proposalSections.proposalId, p.id)),
      db
        .select({ total: sql<number>`count(*)::int`, mapped: sql<number>`count(${complianceItems.proposalSectionId})::int` })
        .from(complianceItems)
        .where(eq(complianceItems.proposalId, p.id)),
      db.select({ color: proposalReviews.color, status: proposalReviews.status, verdict: proposalReviews.verdict }).from(proposalReviews).where(eq(proposalReviews.proposalId, p.id)),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(proposalReviewComments)
        .innerJoin(proposalReviews, eq(proposalReviews.id, proposalReviewComments.reviewId))
        .where(and(eq(proposalReviews.proposalId, p.id), eq(proposalReviewComments.resolved, false))),
      db
        .select({ at: proposalScanResults.generatedAt })
        .from(proposalScanResults)
        .where(and(eq(proposalScanResults.organizationId, organizationId), eq(proposalScanResults.proposalId, p.id)))
        .orderBy(desc(proposalScanResults.generatedAt))
        .limit(1),
      db.select({ type: proposalOutcomes.outcomeType }).from(proposalOutcomes).where(and(eq(proposalOutcomes.organizationId, organizationId), eq(proposalOutcomes.proposalId, p.id))).limit(1),
      db.select({ status: proposalDebriefs.status }).from(proposalDebriefs).where(and(eq(proposalDebriefs.organizationId, organizationId), eq(proposalDebriefs.proposalId, p.id))).limit(1),
    ]);
    let lastSectionSavedAt: Date | null = null;
    for (const s of sections) if (!lastSectionSavedAt || s.updatedAt > lastSectionSavedAt) lastSectionSavedAt = s.updatedAt;
    proposalState = {
      id: p.id,
      stage: p.stage,
      submittedAt: p.submittedAt,
      sections: {
        total: sections.length,
        notStarted: sections.filter((s) => s.status === "not_started").length,
        draftOrBetter: sections.filter((s) => s.status !== "not_started" && s.status !== "in_progress").length,
        overCap: sections.filter((s) => s.pageLimit && s.wordCount > s.pageLimit * WORDS_PER_PAGE).length,
      },
      compliance: { total: compliance[0]?.total ?? 0, mapped: compliance[0]?.mapped ?? 0 },
      reviews: { any: reviews.length > 0, goldPassed: reviews.some((r) => r.color === "gold" && r.status === "complete" && r.verdict === "pass") },
      openComments: comments[0]?.n ?? 0,
      lastScanAt: scan[0]?.at ?? null,
      lastSectionSavedAt,
      outcome: outcome[0]?.type ?? null,
      debriefHeld: debrief[0]?.status === "held",
    };
  }

  return {
    ownerUserId: opp.ownerUserId,
    state: {
      opportunityId: opp.id,
      stage: canonicalStage(opp.stage),
      responseDueDate: opp.responseDueDate,
      awardDate: opp.awardDate,
      solicitation: sol[0] ?? null,
      evaluationSaved: evaluation.length > 0,
      questionnaire,
      briefExists: brief.length > 0,
      incumbentRecorded: incumbent.length > 0 || opp.incumbent.trim().length > 0,
      proposal: proposalState,
      proposedLessons: lessons[0]?.n ?? 0,
    },
  };
}

/** The pursuits the nightly pass looks at: active, or closed within the last 60 days; most recently touched first. */
export async function listPursuitsToRefresh(limit: number): Promise<{ organizationId: string; opportunityId: string }[]> {
  const since = new Date(Date.now() - 60 * 86_400_000);
  const rows = await db
    .select({ organizationId: opportunities.organizationId, opportunityId: opportunities.id })
    .from(opportunities)
    .where(or(inArray(opportunities.stage, ["identified", "sources_sought", "qualification", "capture", "pre_proposal", "writing", "submitted"]), and(isNotNull(opportunities.updatedAt), gt(opportunities.updatedAt, since))))
    .orderBy(desc(opportunities.updatedAt))
    .limit(limit);
  return rows;
}
