/**
 * BL-FB-X-COLOR-TEAM Slice 2 — the AI debrief of a colour-team round.
 *
 * Builds the consolidated report the page already shows (comments by
 * section, verdicts, checklist progress), asks the model for the
 * debrief, falls back to the heuristic summary in stub mode or when the
 * answer is unusable (slot refunded), and stores the result on the
 * round. Gated by the drafting feature and the monthly request quota.
 * Server-only; callers own auth.
 */
import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  proposalReviewAssignments,
  proposalReviewChecklistItems,
  proposalReviewComments,
  proposalReviews,
  proposalSections,
  proposals,
  users,
  type ReviewAiSummary,
} from "@/db/schema";
import { completeStructuredForTenant } from "@/lib/ai";
import { REVIEW_SUMMARY_PROMPT_VERSION, buildReviewSummaryPrompt, reviewSummarySchema } from "@/lib/ai-prompts";
import { recordAudit } from "@/lib/audit-log";
import { log } from "@/lib/log";
import { REVIEW_COLOR_LABELS, VERDICT_LABELS } from "@/lib/review-types";
import {
  checklistProgress,
  consolidateComments,
  consolidatedReport,
  heuristicSummary,
  sanitizeSummary,
} from "@/lib/review-workflow-logic";
import { enforceQuota, ensureFeature, FeatureGateError, QuotaExceededError, refundQuota } from "@/lib/subscription-gates";

type Actor = { userId: string | null; email?: string | null };

export type SummarizeReviewResult =
  | { ok: true; summary: ReviewAiSummary; stubbed: boolean; fallback: boolean }
  | { ok: false; error: string };

export async function summarizeReview(input: { organizationId: string; reviewId: string; actor: Actor }): Promise<SummarizeReviewResult> {
  const { organizationId } = input;
  const [review] = await db
    .select({
      id: proposalReviews.id,
      proposalId: proposalReviews.proposalId,
      color: proposalReviews.color,
      dueDate: proposalReviews.dueDate,
      instructions: proposalReviews.instructions,
      checklist: proposalReviews.checklist,
      proposalTitle: proposals.title,
    })
    .from(proposalReviews)
    .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
    .where(and(eq(proposalReviews.id, input.reviewId), eq(proposals.organizationId, organizationId)))
    .limit(1);
  if (!review) return { ok: false, error: "Review not found." };

  const [sections, comments, assignments, ticks] = await Promise.all([
    db
      .select({ id: proposalSections.id, title: proposalSections.title, ordering: proposalSections.ordering })
      .from(proposalSections)
      .where(eq(proposalSections.proposalId, review.proposalId))
      .orderBy(asc(proposalSections.ordering)),
    db
      .select({
        id: proposalReviewComments.id,
        sectionId: proposalReviewComments.sectionId,
        userId: proposalReviewComments.userId,
        body: proposalReviewComments.body,
        resolved: proposalReviewComments.resolved,
        createdAt: proposalReviewComments.createdAt,
        authorName: users.name,
        authorEmail: users.email,
      })
      .from(proposalReviewComments)
      .leftJoin(users, eq(users.id, proposalReviewComments.userId))
      .where(eq(proposalReviewComments.reviewId, review.id)),
    db
      .select({
        userId: proposalReviewAssignments.userId,
        verdict: proposalReviewAssignments.verdict,
        summary: proposalReviewAssignments.summary,
        name: users.name,
        email: users.email,
      })
      .from(proposalReviewAssignments)
      .leftJoin(users, eq(users.id, proposalReviewAssignments.userId))
      .where(eq(proposalReviewAssignments.reviewId, review.id)),
    db
      .select({ userId: proposalReviewChecklistItems.userId, itemKey: proposalReviewChecklistItems.itemKey, checked: proposalReviewChecklistItems.checked })
      .from(proposalReviewChecklistItems)
      .where(eq(proposalReviewChecklistItems.reviewId, review.id)),
  ]);
  if (comments.length === 0 && assignments.every((a) => !a.verdict)) {
    return { ok: false, error: "Nothing to summarise yet — the round has no comments or verdicts." };
  }

  const colorLabel = REVIEW_COLOR_LABELS[review.color];
  const groups = consolidateComments(
    sections,
    comments.map((c) => ({
      id: c.id,
      sectionId: c.sectionId,
      body: c.body,
      resolved: c.resolved,
      authorName: c.userId ? c.authorName ?? c.authorEmail ?? "Reviewer" : null,
      createdAt: c.createdAt.toISOString(),
    })),
  );
  const sectionNumbers = new Map(sections.map((s) => [s.id, s.ordering] as const));
  const verdicts = assignments.map((a) => ({ name: a.name ?? a.email ?? "Reviewer", verdict: a.verdict ? VERDICT_LABELS[a.verdict] : null, summary: a.summary }));
  const reviewerIds = assignments.map((a) => a.userId);
  const progress = checklistProgress(review.checklist, ticks, reviewerIds);
  const uncheckedLabels = review.checklist
    .filter((item) => reviewerIds.some((uid) => !ticks.some((t) => t.userId === uid && t.itemKey === item.key && t.checked)))
    .map((item) => item.label);
  const report = consolidatedReport({
    proposalTitle: review.proposalTitle,
    colorLabel,
    dueDate: review.dueDate ? review.dueDate.toISOString().slice(0, 10) : null,
    instructions: review.instructions,
    groups,
    sectionNumbers,
    verdicts,
    checklist: progress,
  });

  try {
    await ensureFeature(organizationId, "aiAutoDraft");
    await enforceQuota(organizationId, "aiRequestsPerMonth");
  } catch (err) {
    if (err instanceof FeatureGateError || err instanceof QuotaExceededError) return { ok: false, error: err.message };
    throw err;
  }
  const refund = () => refundQuota(organizationId, "aiRequestsPerMonth").catch(() => undefined);

  const fallbackSummary = () => heuristicSummary({ colorLabel, groups, verdicts, checklist: progress, uncheckedLabels, sectionNumbers });
  let summary: ReviewAiSummary;
  let stubbed = false;
  try {
    const prompt = buildReviewSummaryPrompt({ report: report.slice(0, 24_000), uncheckedLabels });
    const res = await completeStructuredForTenant({
      organizationId,
      feature: "review_summary",
      promptVersion: REVIEW_SUMMARY_PROMPT_VERSION,
      schema: reviewSummarySchema,
      toolName: "record_summary",
      toolDescription: "Record the debrief of this colour-team round.",
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: 1_500,
      temperature: 0.2,
      cacheSystem: true,
    });
    stubbed = res.stubbed;
    const clean = res.stubbed ? null : sanitizeSummary(res.data, { fallback: false, model: res.model });
    if (clean) summary = clean;
    else {
      summary = fallbackSummary();
      if (!res.stubbed) {
        await refund();
        log.warn("[review-summary]", "model returned nothing usable", { organizationId, reviewId: review.id, error: res.parseError });
      }
    }
  } catch (err) {
    summary = fallbackSummary();
    await refund();
    log.error("[review-summary]", "summary call failed", { organizationId, reviewId: review.id, error: err });
  }

  await db
    .update(proposalReviews)
    .set({ aiSummary: summary, aiSummaryAt: new Date(), updatedAt: new Date() })
    .where(eq(proposalReviews.id, review.id));
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "proposal.review.summarize",
    resourceType: "proposal_review",
    resourceId: review.id,
    metadata: { proposalId: review.proposalId, color: review.color, comments: comments.length, stubbed, fallback: summary.fallback, model: summary.model },
  });
  return { ok: true, summary, stubbed, fallback: summary.fallback };
}
