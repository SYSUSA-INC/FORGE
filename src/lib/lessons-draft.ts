import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  opportunities,
  opportunityLessonApplications,
  opportunityLessons,
  proposalDebriefs,
  proposalOutcomes,
  proposalReviewComments,
  proposalReviews,
  proposals,
  proposalSections,
  proposalWinnerAnalyses,
} from "@/db/schema";
import { completeStructuredForTenant } from "@/lib/ai";
import { recordAudit } from "@/lib/audit-log";
import { acceptDraftedLessons, draftedLessonsSchema } from "@/lib/lessons";
import { buildLessonsExtractPrompt } from "@/lib/lessons-prompt";
import { getLossIntelligence } from "@/lib/loss-intelligence";
import { log } from "@/lib/log";
import { enforceRateLimit } from "@/lib/rate-limit";
import { enforceQuota, ensureFeature, FeatureGateError, QuotaExceededError, refundQuota } from "@/lib/subscription-gates";

/**
 * BL-LESSONS-LOOP phase 4a — FORGE drafts lessons for a decided bid from
 * its outcome, debrief, winner analysis, open review comments and the
 * matching loss patterns. Rows land as `proposed`; a person confirms.
 * Called by the Outcome tab's button and, best-effort, when an outcome is
 * recorded or a debrief is held (the owner's decision 2).
 */
export type DraftLessonsResult = { ok: true; drafted: number; skipped: number } | { ok: false; error: string };

export async function draftLessonsForProposal(input: {
  organizationId: string;
  proposalId: string;
  actor: { userId: string | null; email?: string | null };
}): Promise<DraftLessonsResult> {
  const { organizationId, proposalId } = input;
  const [row] = await db
    .select({
      id: proposals.id,
      title: proposals.title,
      opportunityId: proposals.opportunityId,
      agency: opportunities.agency,
      naicsCode: opportunities.naicsCode,
    })
    .from(proposals)
    .innerJoin(opportunities, eq(opportunities.id, proposals.opportunityId))
    .where(and(eq(proposals.id, proposalId), eq(proposals.organizationId, organizationId), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  if (!row) return { ok: false, error: "Proposal not found, or it has no opportunity." };

  const [outcome] = await db
    .select()
    .from(proposalOutcomes)
    .where(and(eq(proposalOutcomes.proposalId, proposalId), eq(proposalOutcomes.organizationId, organizationId)))
    .limit(1);
  if (!outcome || (outcome.outcomeType !== "won" && outcome.outcomeType !== "lost")) {
    return { ok: false, error: "Record a won or lost outcome first; lessons come from how the bid ended." };
  }

  try {
    await ensureFeature(organizationId, "aiAutoDraft");
    await enforceQuota(organizationId, "aiRequestsPerMonth");
  } catch (err) {
    if (err instanceof FeatureGateError || err instanceof QuotaExceededError) return { ok: false, error: err.message };
    throw err;
  }
  const limit = await enforceRateLimit({ key: `lessons-extract:${organizationId}`, limit: 20, windowSeconds: 3600 });
  if (!limit.ok) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return { ok: false, error: `Lesson-drafting limit reached (20/hour). Retry in ${Math.ceil(limit.retryAfter / 60)} min.` };
  }

  const [[debrief], winners, comments, sections, existing, loss] = await Promise.all([
    db.select().from(proposalDebriefs).where(and(eq(proposalDebriefs.proposalId, proposalId), eq(proposalDebriefs.organizationId, organizationId))).limit(1),
    db
      .select({ id: proposalWinnerAnalyses.id, gaps: proposalWinnerAnalyses.gapsWeHad })
      .from(proposalWinnerAnalyses)
      .where(and(eq(proposalWinnerAnalyses.proposalId, proposalId), eq(proposalWinnerAnalyses.organizationId, organizationId)))
      .orderBy(desc(proposalWinnerAnalyses.createdAt))
      .limit(3),
    db
      .select({ id: proposalReviewComments.id, body: proposalReviewComments.body, section: proposalSections.title })
      .from(proposalReviewComments)
      .innerJoin(proposalReviews, eq(proposalReviews.id, proposalReviewComments.reviewId))
      .leftJoin(proposalSections, eq(proposalSections.id, proposalReviewComments.sectionId))
      // proposal_review carries no organization_id; the proposal above is org-owned.
      .where(and(eq(proposalReviews.proposalId, proposalId), eq(proposalReviewComments.resolved, false)))
      .orderBy(desc(proposalReviewComments.createdAt))
      .limit(20),
    db.select({ kind: proposalSections.kind }).from(proposalSections).where(eq(proposalSections.proposalId, proposalId)),
    db
      .select({ text: opportunityLessons.text })
      .from(opportunityLessons)
      .where(and(eq(opportunityLessons.organizationId, organizationId), eq(opportunityLessons.opportunityId, row.opportunityId))),
    getLossIntelligence(organizationId).catch((err) => {
      log.warn("[draftLessons]", "loss intelligence failed", { error: err });
      return null;
    }),
  ]);

  const prompt = buildLessonsExtractPrompt({
    proposal: {
      title: row.title,
      agency: row.agency,
      naicsCode: row.naicsCode,
      outcome: outcome.outcomeType,
      reasons: outcome.reasons ?? [],
      summary: outcome.summary,
      lessonsLearned: outcome.lessonsLearned,
      awardedTo: outcome.awardedToCompetitor,
    },
    outcomeId: outcome.id,
    debrief: debrief ? { id: debrief.id, status: debrief.status, strengths: debrief.strengths, weaknesses: debrief.weaknesses, improvements: debrief.improvements, notes: debrief.notes } : null,
    winnerGaps: winners.filter((w) => w.gaps.trim()).map((w) => ({ id: w.id, text: w.gaps })),
    reviewComments: comments.map((c) => ({ id: c.id, section: c.section ?? "proposal", text: c.body })),
    lossPatterns: (loss?.patterns ?? []).slice(0, 6).map((p) => ({ id: p.id, title: p.title, detail: p.detail })),
    sectionKinds: Array.from(new Set(sections.map((s) => s.kind))),
    existing: existing.map((e) => e.text),
  });
  const res = await completeStructuredForTenant({
    organizationId,
    feature: "lessons_extract",
    schema: draftedLessonsSchema,
    toolName: "record_lessons",
    toolDescription: "Record the lessons this bid taught, each with its kind, source, what it applies to and the evidence ids.",
    system: prompt.system,
    messages: prompt.messages,
    maxTokens: 2500,
    temperature: 0.2,
    cacheSystem: true,
  });
  if (res.stubbed) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    return { ok: false, error: "AI provider is in stub mode — configure a provider to draft lessons." };
  }
  if (!res.data) {
    await refundQuota(organizationId, "aiRequestsPerMonth");
    log.warn("[draftLessons]", "structured parse failed", { parseError: res.parseError, viaTool: res.viaTool });
    return { ok: false, error: "AI returned an unexpected format. Try again." };
  }

  const allowed = new Set<string>([
    `outcome:${outcome.id}`,
    ...(debrief ? [`debrief:${debrief.id}`] : []),
    ...winners.map((w) => `winner:${w.id}`),
    ...comments.map((c) => `comment:${c.id}`),
    ...(loss?.patterns ?? []).map((p) => `pattern:${p.id}`),
  ]);
  const accepted = acceptDraftedLessons({ parsed: res.data, allowedEvidence: allowed, existingTexts: existing.map((e) => e.text), agency: row.agency, naicsCode: row.naicsCode });
  if (accepted.length > 0) {
    await db.insert(opportunityLessons).values(
      accepted.map((l) => ({
        organizationId,
        opportunityId: row.opportunityId,
        proposalId,
        source: l.source,
        kind: l.kind,
        text: l.text,
        appliesTo: l.appliesTo,
        evidence: l.evidence,
        status: "proposed",
        createdByUserId: input.actor.userId,
      })),
    );
  }
  await recordAudit({
    organizationId,
    actor: { userId: input.actor.userId ?? "system", email: input.actor.email ?? "system" },
    action: "opportunity.lesson.draft",
    resourceType: "opportunity",
    resourceId: row.opportunityId,
    metadata: { proposalId, drafted: accepted.length, offered: res.data.lessons.length, model: res.model },
  });
  return { ok: true, drafted: accepted.length, skipped: res.data.lessons.length - accepted.length };
}

/** Lessons on an opportunity, newest first, with the bid each came from. */
export async function listLessons(input: { organizationId: string; opportunityId?: string }) {
  const where = input.opportunityId
    ? and(eq(opportunityLessons.organizationId, input.organizationId), eq(opportunityLessons.opportunityId, input.opportunityId))
    : eq(opportunityLessons.organizationId, input.organizationId);
  const rows = await db
    .select({
      id: opportunityLessons.id,
      opportunityId: opportunityLessons.opportunityId,
      proposalId: opportunityLessons.proposalId,
      source: opportunityLessons.source,
      kind: opportunityLessons.kind,
      text: opportunityLessons.text,
      appliesTo: opportunityLessons.appliesTo,
      evidence: opportunityLessons.evidence,
      status: opportunityLessons.status,
      confirmedAt: opportunityLessons.confirmedAt,
      createdAt: opportunityLessons.createdAt,
      opportunityTitle: opportunities.title,
    })
    .from(opportunityLessons)
    .innerJoin(opportunities, eq(opportunities.id, opportunityLessons.opportunityId))
    .where(where)
    .orderBy(desc(opportunityLessons.createdAt))
    .limit(500);
  const proposalIds = Array.from(new Set(rows.map((r) => r.proposalId).filter((x): x is string => !!x)));
  const titles = proposalIds.length
    ? await db.select({ id: proposals.id, title: proposals.title }).from(proposals).where(and(eq(proposals.organizationId, input.organizationId), inArray(proposals.id, proposalIds)))
    : [];
  const titleOf = new Map(titles.map((t) => [t.id, t.title]));
  // Phase 4c — where each lesson was applied and how that bid ended.
  const lessonIds = rows.map((r) => r.id);
  const apps = lessonIds.length
    ? await db
        .select({ lessonId: opportunityLessonApplications.lessonId, proposalId: opportunityLessonApplications.proposalId, outcomeType: opportunityLessonApplications.outcomeType, appliedAt: opportunityLessonApplications.appliedAt, proposalTitle: proposals.title })
        .from(opportunityLessonApplications)
        .innerJoin(proposals, eq(proposals.id, opportunityLessonApplications.proposalId))
        .where(and(eq(opportunityLessonApplications.organizationId, input.organizationId), inArray(opportunityLessonApplications.lessonId, lessonIds)))
    : [];
  const appsOf = new Map<string, { proposalId: string; proposalTitle: string; outcomeType: string | null; appliedAt: Date }[]>();
  for (const a of apps) {
    const list = appsOf.get(a.lessonId) ?? [];
    if (!list.some((x) => x.proposalId === a.proposalId)) list.push({ proposalId: a.proposalId, proposalTitle: a.proposalTitle, outcomeType: a.outcomeType, appliedAt: a.appliedAt });
    appsOf.set(a.lessonId, list);
  }
  return rows.map((r) => ({ ...r, proposalTitle: r.proposalId ? (titleOf.get(r.proposalId) ?? null) : null, applications: appsOf.get(r.id) ?? [] }));
}
