/**
 * BL-AIP-6 — AI colour-team pre-review.
 *
 * When a review starts, each section is read once by the model against
 * its mapped requirements and the win themes, and the findings land as
 * review comments authored by FORGE AI (`user_id` null) so the human
 * reviewers open the review to findings, not a blank thread. The
 * comments feed back into the drafter and chat through
 * `writing-signals.ts` until someone resolves them.
 *
 * Runs in the background after `startReviewAction`; feature- and
 * quota-gated; skipped in stub mode; never throws into the action.
 */
import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  complianceItems,
  proposalReviewComments,
  proposalReviews,
  proposalSections,
  proposals,
  type TipTapDoc,
} from "@/db/schema";
import { completeStructuredForTenant } from "@/lib/ai";
import { buildReviewPreflightPrompt, reviewPreflightSchema } from "@/lib/ai-prompts";
import { recordAudit } from "@/lib/audit-log";
import {
  enforceQuota,
  ensureFeature,
  FeatureGateError,
  QuotaExceededError,
  refundQuota,
} from "@/lib/subscription-gates";
import { projectToPlain } from "@/lib/tiptap-doc";
import { log } from "@/lib/log";

export const PREFLIGHT_MAX_SECTIONS = 8;
export const PREFLIGHT_MAX_COMMENTS_PER_SECTION = 3;
export const AI_REVIEW_PREFIX = "[FORGE AI pre-review";

export type ReviewPreflightSummary = {
  sectionsReviewed: number;
  commentsWritten: number;
  verdicts: Record<"pass" | "conditional" | "fail", number>;
  stubbed: boolean;
  skipped?: string;
};

export async function runReviewPreflight(input: {
  organizationId: string;
  proposalId: string;
  reviewId: string;
  color: string;
  actor: { id: string; email?: string | null };
}): Promise<ReviewPreflightSummary> {
  const { organizationId, proposalId, reviewId } = input;
  const summary: ReviewPreflightSummary = {
    sectionsReviewed: 0,
    commentsWritten: 0,
    verdicts: { pass: 0, conditional: 0, fail: 0 },
    stubbed: false,
  };

  try {
    await ensureFeature(organizationId, "aiAutoDraft");
    await enforceQuota(organizationId, "aiRequestsPerMonth");
  } catch (err) {
    if (err instanceof FeatureGateError || err instanceof QuotaExceededError) {
      return { ...summary, skipped: err.message };
    }
    throw err;
  }

  const [review] = await db
    .select({ id: proposalReviews.id, winThemes: proposals.winThemes })
    .from(proposalReviews)
    .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
    .where(
      and(
        eq(proposalReviews.id, reviewId),
        eq(proposalReviews.proposalId, proposalId),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!review) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return { ...summary, skipped: "review not found" };
  }

  const sections = await db
    .select({
      id: proposalSections.id,
      title: proposalSections.title,
      kind: proposalSections.kind,
      pageLimit: proposalSections.pageLimit,
      wordCount: proposalSections.wordCount,
      bodyDoc: proposalSections.bodyDoc,
      content: proposalSections.content,
    })
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, proposalId))
    .orderBy(asc(proposalSections.ordering));

  const mapped = await db
    .select({
      sectionId: complianceItems.proposalSectionId,
      number: complianceItems.number,
      text: complianceItems.requirementText,
    })
    .from(complianceItems)
    .where(eq(complianceItems.proposalId, proposalId))
    .orderBy(asc(complianceItems.ordering));
  const reqsBySection = new Map<string, { number: string; text: string }[]>();
  for (const m of mapped) {
    if (!m.sectionId) continue;
    const list = reqsBySection.get(m.sectionId) ?? [];
    list.push({ number: m.number, text: m.text });
    reqsBySection.set(m.sectionId, list);
  }
  const winThemes = (review.winThemes ?? []).slice(0, 3).map((t) => ({
    title: t.title ?? "",
    statement: t.statement ?? "",
  }));

  const candidates = sections
    .map((s) => ({ ...s, body: projectToPlain(s.bodyDoc as TipTapDoc | null) || s.content || "" }))
    .filter((s) => s.body.trim().split(/\s+/).length >= 30)
    .slice(0, PREFLIGHT_MAX_SECTIONS);

  for (const s of candidates) {
    const prompt = buildReviewPreflightPrompt({
      color: input.color,
      sectionTitle: s.title,
      sectionKind: s.kind,
      pageLimit: s.pageLimit,
      wordCount: s.wordCount,
      body: s.body,
      requirements: reqsBySection.get(s.id) ?? [],
      winThemes,
    });
    try {
      const res = await completeStructuredForTenant({
        organizationId,
        feature: "review_preflight",
        variant: input.color,
        schema: reviewPreflightSchema,
        toolName: "record_review_findings",
        toolDescription: "Record the verdict and up to three reviewer comments for this section.",
        system: prompt.system,
        messages: prompt.messages,
        maxTokens: 1200,
        temperature: 0.2,
        cacheSystem: true,
      });
      if (res.stubbed) {
        summary.stubbed = true;
        break;
      }
      if (!res.data) {
        log.warn("[review-preflight]", "verdict did not validate", { sectionId: s.id, parseError: res.parseError });
        continue;
      }
      summary.sectionsReviewed += 1;
      summary.verdicts[res.data.verdict] += 1;
      const comments = res.data.comments.slice(0, PREFLIGHT_MAX_COMMENTS_PER_SECTION);
      const rows = [
        ...(res.data.summary.trim()
          ? [
              {
                reviewId,
                sectionId: s.id,
                userId: null,
                body: `${AI_REVIEW_PREFIX} · ${input.color} · ${res.data.verdict}] ${res.data.summary.trim().slice(0, 1_000)}`,
              },
            ]
          : []),
        ...comments.map((c) => ({
          reviewId,
          sectionId: s.id,
          userId: null,
          body: `${AI_REVIEW_PREFIX} · ${c.severity}] ${c.text.trim().slice(0, 1_500)}`,
        })),
      ].filter((r) => r.body.length > AI_REVIEW_PREFIX.length + 4);
      if (rows.length > 0) {
        await db.insert(proposalReviewComments).values(rows);
        summary.commentsWritten += rows.length;
      }
    } catch (err) {
      log.warn("[review-preflight]", "section pre-review failed", { sectionId: s.id, error: err });
    }
  }

  if (summary.commentsWritten === 0) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
  }
  await recordAudit({
    organizationId,
    actor: { userId: input.actor.id, email: input.actor.email },
    action: "proposal.review.preflight",
    resourceType: "proposal_review",
    resourceId: reviewId,
    metadata: { proposalId, color: input.color, ...summary },
  });
  return summary;
}
