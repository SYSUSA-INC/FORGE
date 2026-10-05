/**
 * BL-AIP-7a — stored, grounded, graded briefs.
 *
 * The pursuit brief and the pipeline brief used to be generated into an
 * in-process five-minute cache from the hand-set PWin and the raw
 * record: nothing persisted, no feedback, never checked against how
 * the pursuit ended, and blind to the intelligence the platform already
 * computes. Now:
 *
 *   grounded — the pursuit snapshot carries the calibrated PWin with
 *              its factors and track record, recompete matches with
 *              lessons, the customer record at the agency, this
 *              organization's loss patterns and matching Brain passages;
 *              the pipeline snapshot carries the model track and loss
 *              intelligence.
 *   stored   — every generation is an ai_brief row (snapshot, text,
 *              structured take, model, prompt version); a recent row
 *              with an unchanged snapshot is reused instead of a new
 *              call.
 *   graded   — when the opportunity closes, every pursuit brief that
 *              made a call on it is graded against the outcome
 *              (`gradeRecommendation`); the track is shown on the panel.
 *   fed back — readers mark a brief useful / not useful.
 *
 * Every read and write carries organizationId. Server-only; callers
 * own auth.
 */
import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  aiBriefs,
  opportunities,
  opportunityActivities,
  opportunityCompetitors,
  opportunityEvaluations,
  organizations,
  proposalReviews,
  proposals,
  type AiBrief,
  type OpportunityStage,
  type ProposalStage,
} from "@/db/schema";
import { completeStructuredForTenant } from "@/lib/ai";
import {
  BRIEF_PROMPT_VERSION,
  PIPELINE_BRIEF_PROMPT_VERSION,
  buildOpportunityBriefPrompt,
  buildPipelineBriefPrompt,
  pipelineBriefSchema,
  pursuitBriefSchema,
  type OpportunitySnapshot,
  type PipelineSnapshot,
} from "@/lib/ai-prompts";
import { recordAudit } from "@/lib/audit-log";
import { searchBrain } from "@/lib/brain-retrieval";
import {
  briefIsFresh,
  clampConfidence,
  cleanList,
  gradeRecommendation,
  isRecommendation,
  snapshotKeyOf,
  summarizeBriefTrack,
  type BriefFeedback,
  type BriefOutcome,
  type BriefTrack,
  type StoredBrief,
} from "@/lib/brief-logic";
import { getCustomerIntelligence } from "@/lib/customer-intelligence";
import { getLossIntelligence } from "@/lib/loss-intelligence";
import { log } from "@/lib/log";
import { STAGE_LABELS as OPP_STAGE_LABELS } from "@/lib/opportunity-types";
import { STAGE_LABELS as PROP_STAGE_LABELS } from "@/lib/proposal-types";
import { computePwin, getPwinTrack } from "@/lib/pwin";
import { getRecompeteForOpportunity } from "@/lib/recompete-radar";

const DAY_MS = 24 * 60 * 60_000;

export type BriefResult = { ok: true; brief: StoredBrief; reused: boolean } | { ok: false; error: string };

export function toStoredBrief(row: AiBrief): StoredBrief {
  return {
    id: row.id,
    kind: row.kind,
    opportunityId: row.opportunityId,
    text: row.text,
    recommendation: isRecommendation(row.recommendation) ? row.recommendation : null,
    confidence: row.confidence,
    signals: row.signals ?? [],
    nextActions: row.nextActions ?? [],
    model: row.model,
    stubbed: row.stubbed,
    promptVersion: row.promptVersion,
    feedback: row.feedback === "useful" || row.feedback === "not_useful" ? row.feedback : null,
    outcome: row.outcome === "won" || row.outcome === "lost" || row.outcome === "no_bid" ? row.outcome : null,
    grade: row.grade === "correct" || row.grade === "wrong" || row.grade === "inconclusive" ? row.grade : null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── pursuit ───────────────────────────────────────────────────────────

async function buildPursuitSnapshot(
  organizationId: string,
  opportunityId: string,
): Promise<{ snapshot: OpportunitySnapshot; key: string } | null> {
  const [oppRow] = await db
    .select()
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  if (!oppRow) return null;

  const [orgRow] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  const [evalRow] = await db
    .select()
    .from(opportunityEvaluations)
    .where(eq(opportunityEvaluations.opportunityId, opportunityId))
    .limit(1);
  const competitors = await db
    .select()
    .from(opportunityCompetitors)
    .where(eq(opportunityCompetitors.opportunityId, opportunityId));
  const activity = await db
    .select()
    .from(opportunityActivities)
    .where(eq(opportunityActivities.opportunityId, opportunityId))
    .orderBy(desc(opportunityActivities.createdAt))
    .limit(8);

  const now = new Date();
  const daysToDue = oppRow.responseDueDate
    ? Math.ceil((oppRow.responseDueDate.getTime() - now.getTime()) / DAY_MS)
    : null;
  let rollup: number | null = null;
  if (evalRow) {
    const dims = [
      evalRow.strategicFit,
      evalRow.customerRelationship,
      evalRow.competitivePosture,
      evalRow.resourceAvailability,
      evalRow.financialAttractiveness,
    ];
    rollup = Math.round(dims.reduce((a, b) => a + b, 0) / dims.length);
  }

  // Grounding — each signal is best-effort; a failure leaves it out.
  const [pwin, recompete, customer, loss, brain] = await Promise.all([
    computePwin(organizationId, opportunityId).catch((err) => {
      log.warn("[briefs]", "pwin failed", { error: err });
      return null;
    }),
    getRecompeteForOpportunity({ organizationId, opportunityId, limit: 3 }).catch((err) => {
      log.warn("[briefs]", "recompete failed", { error: err });
      return [];
    }),
    getCustomerIntelligence({
      organizationId,
      agency: oppRow.agency,
      linkedOpportunityId: null,
      naicsCode: oppRow.naicsCode,
    }).catch((err) => {
      log.warn("[briefs]", "customer intel failed", { error: err });
      return null;
    }),
    getLossIntelligence(organizationId).catch((err) => {
      log.warn("[briefs]", "loss intel failed", { error: err });
      return null;
    }),
    searchBrain({
      organizationId,
      query: `${oppRow.title} ${oppRow.agency} ${oppRow.description.slice(0, 600)}`,
      take: 4,
    }).catch((err) => {
      log.warn("[briefs]", "brain search failed", { error: err });
      return null;
    }),
  ]);

  const snapshot: OpportunitySnapshot = {
    organizationName: orgRow?.name ?? "your organization",
    asOf: now.toISOString().slice(0, 10),
    opportunity: {
      title: oppRow.title,
      agency: oppRow.agency,
      office: oppRow.office,
      stage: OPP_STAGE_LABELS[oppRow.stage] ?? oppRow.stage,
      solicitationNumber: oppRow.solicitationNumber,
      naicsCode: oppRow.naicsCode,
      pscCode: oppRow.pscCode,
      setAside: oppRow.setAside,
      contractType: oppRow.contractType,
      placeOfPerformance: oppRow.placeOfPerformance,
      incumbent: oppRow.incumbent,
      valueLow: oppRow.valueLow,
      valueHigh: oppRow.valueHigh,
      pwin: oppRow.pWin,
      daysToDue,
      description: oppRow.description.slice(0, 1500),
    },
    evaluation: evalRow
      ? {
          rollupScore: rollup,
          strategicFit: evalRow.strategicFit,
          customerRelationship: evalRow.customerRelationship,
          competitivePosture: evalRow.competitivePosture,
          resourceAvailability: evalRow.resourceAvailability,
          financialAttractiveness: evalRow.financialAttractiveness,
          rationale: evalRow.rationale.slice(0, 800),
        }
      : null,
    competitors: competitors.map((c) => ({
      name: c.name,
      isIncumbent: c.isIncumbent,
      strengths: c.strengths.slice(0, 400),
      weaknesses: c.weaknesses.slice(0, 400),
      notes: c.notes.slice(0, 400),
    })),
    recentActivity: activity.map((a) => ({
      kind: a.kind,
      title: a.title,
      body: a.body.slice(0, 400),
      daysAgo: Math.max(0, Math.round((now.getTime() - a.createdAt.getTime()) / DAY_MS)),
    })),
    modelPwin: pwin
      ? {
          pwin: pwin.score.pwin,
          confidence: pwin.score.confidence,
          factors: pwin.score.factors.slice(0, 8).map((f) => ({
            label: f.label,
            detail: f.detail.slice(0, 200),
            direction: f.logOdds >= 0 ? "up" : "down",
          })),
          track: pwin.track,
        }
      : null,
    recompete: recompete.map((m) => ({
      title: m.prior.title,
      outcome: m.prior.outcome,
      decidedAt: m.prior.decidedAt,
      awardedTo: m.prior.awardedTo,
      confidence: m.confidence,
      lessonsLearned: m.prior.lessonsLearned.slice(0, 400),
      weaknesses: (m.prior.debrief?.weaknesses ?? "").slice(0, 400),
    })),
    customer: customer
      ? {
          agency: customer.history.agency,
          pursuits: customer.history.pursuits,
          won: customer.history.won,
          lost: customer.history.lost,
          winRate: customer.history.winRate,
          winners: customer.history.winners.slice(0, 5),
          evaluatorPriorities: customer.history.evaluatorPriorities
            .slice(0, 3)
            .map((p) => p.summary.slice(0, 300)),
        }
      : null,
    lossPatterns: (loss?.patterns ?? []).slice(0, 3).map((p) => ({
      title: p.title,
      severity: p.severity,
      detail: p.detail.slice(0, 300),
    })),
    brainHits:
      brain && brain.ok && !brain.stubbed
        ? brain.hits.slice(0, 4).map((h) => ({
            title: h.title,
            excerpt: h.content.slice(0, 400),
            outcomeLabel: h.outcomeLabel && h.outcomeLabel !== "none" ? h.outcomeLabel : null,
          }))
        : [],
  };

  const key = snapshotKeyOf({
    stage: oppRow.stage,
    pwin: oppRow.pWin,
    model: snapshot.modelPwin?.pwin ?? null,
    due: daysToDue === null ? null : Math.floor(daysToDue / 7),
    eval: rollup,
    competitors: competitors.length,
    activity: activity[0]?.id ?? null,
    recompete: snapshot.recompete?.length ?? 0,
    customer: snapshot.customer?.pursuits ?? 0,
    prompt: BRIEF_PROMPT_VERSION,
  });
  return { snapshot, key };
}

export async function latestBrief(input: {
  organizationId: string;
  kind: "pursuit" | "pipeline";
  opportunityId?: string | null;
}): Promise<AiBrief | null> {
  const { organizationId } = input;
  const [row] = await db
    .select()
    .from(aiBriefs)
    .where(
      and(
        eq(aiBriefs.organizationId, organizationId),
        eq(aiBriefs.kind, input.kind),
        input.kind === "pursuit" && input.opportunityId
          ? eq(aiBriefs.opportunityId, input.opportunityId)
          : isNull(aiBriefs.opportunityId),
      ),
    )
    .orderBy(desc(aiBriefs.createdAt))
    .limit(1);
  return row ?? null;
}

/** Generate (or reuse) the pursuit brief for an opportunity. */
export async function generatePursuitBrief(input: {
  organizationId: string;
  opportunityId: string;
  actor: { userId: string | null; email?: string | null };
  force?: boolean;
}): Promise<BriefResult> {
  const { organizationId, opportunityId } = input;
  const built = await buildPursuitSnapshot(organizationId, opportunityId);
  if (!built) return { ok: false, error: "Opportunity not found." };

  if (!input.force) {
    const last = await latestBrief({ organizationId, kind: "pursuit", opportunityId });
    if (last && !last.stubbed && briefIsFresh(last, built.key)) {
      return { ok: true, brief: toStoredBrief(last), reused: true };
    }
  }

  const prompt = buildOpportunityBriefPrompt(built.snapshot);
  const res = await completeStructuredForTenant({
    organizationId,
    feature: "opportunity_brief",
    promptVersion: BRIEF_PROMPT_VERSION,
    schema: pursuitBriefSchema,
    toolName: "record_pursuit_brief",
    toolDescription: "Record the pursuit brief with its recommendation.",
    system: prompt.system,
    messages: prompt.messages,
    maxTokens: 1200,
    temperature: 0.3,
    cacheSystem: true,
  });

  const data = res.data;
  const text = (data?.brief ?? res.text ?? "").trim();
  if (!text) return { ok: false, error: res.parseError ?? "AI returned an empty brief." };

  const [row] = await db
    .insert(aiBriefs)
    .values({
      organizationId,
      kind: "pursuit",
      opportunityId,
      promptVersion: BRIEF_PROMPT_VERSION,
      model: res.model,
      stubbed: res.stubbed,
      snapshotKey: built.key,
      snapshot: built.snapshot as unknown as Record<string, unknown>,
      text,
      recommendation: data && isRecommendation(data.recommendation) ? data.recommendation : null,
      confidence: data ? clampConfidence(data.confidence) : null,
      signals: cleanList(data?.keySignals, 5),
      nextActions: cleanList(data?.nextActions, 4),
      requestedByUserId: input.actor.userId,
    })
    .returning();
  if (!row) return { ok: false, error: "Could not store the brief." };

  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "opportunity.brief.generate",
    resourceType: "opportunity",
    resourceId: opportunityId,
    metadata: {
      briefId: row.id,
      recommendation: row.recommendation,
      confidence: row.confidence,
      stubbed: row.stubbed,
      promptVersion: BRIEF_PROMPT_VERSION,
    },
  });
  return { ok: true, brief: toStoredBrief(row), reused: false };
}

// ── pipeline ──────────────────────────────────────────────────────────

async function buildPipelineSnapshot(
  organizationId: string,
): Promise<{ snapshot: PipelineSnapshot; key: string }> {
  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  const opps = await db
    .select({
      id: opportunities.id,
      title: opportunities.title,
      agency: opportunities.agency,
      stage: opportunities.stage,
      pWin: opportunities.pWin,
      responseDueDate: opportunities.responseDueDate,
    })
    .from(opportunities)
    .where(eq(opportunities.organizationId, organizationId));
  const props = await db
    .select({ id: proposals.id, stage: proposals.stage })
    .from(proposals)
    .where(eq(proposals.organizationId, organizationId));

  const oppByStage: Record<string, number> = {};
  for (const o of opps) {
    const label = OPP_STAGE_LABELS[o.stage as OpportunityStage] ?? o.stage;
    oppByStage[label] = (oppByStage[label] ?? 0) + 1;
  }
  const propByStage: Record<string, number> = {};
  for (const p of props) {
    const label = PROP_STAGE_LABELS[p.stage as ProposalStage] ?? p.stage;
    propByStage[label] = (propByStage[label] ?? 0) + 1;
  }
  const liveOpps = opps.filter((o) => !["won", "lost", "no_bid"].includes(o.stage));
  const now = new Date();
  const fortnight = new Date(now.getTime() + 14 * DAY_MS);

  const inActiveReviewRows = await db
    .select({ id: proposalReviews.id })
    .from(proposalReviews)
    .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
    .where(and(eq(proposals.organizationId, organizationId), eq(proposalReviews.status, "in_progress")));

  const [track, loss] = await Promise.all([
    getPwinTrack(organizationId).catch(() => ({ n: 0, brier: null })),
    getLossIntelligence(organizationId).catch((err) => {
      log.warn("[briefs]", "loss intel failed", { error: err });
      return null;
    }),
  ]);

  const snapshot: PipelineSnapshot = {
    organizationName: org?.name ?? "your organization",
    asOf: now.toISOString().slice(0, 10),
    opportunities: {
      total: opps.length,
      byStage: oppByStage,
      topByPwin: [...liveOpps]
        .filter((o) => typeof o.pWin === "number" && o.pWin > 0)
        .sort((a, b) => (b.pWin ?? 0) - (a.pWin ?? 0))
        .slice(0, 5)
        .map((o) => ({
          title: o.title,
          agency: o.agency,
          stage: OPP_STAGE_LABELS[o.stage as OpportunityStage] ?? o.stage,
          pwin: o.pWin ?? null,
          dueDate: o.responseDueDate ? o.responseDueDate.toISOString().slice(0, 10) : null,
        })),
      upcomingDueWithin14Days: liveOpps
        .filter((o) => o.responseDueDate && o.responseDueDate >= now && o.responseDueDate <= fortnight)
        .sort((a, b) => (a.responseDueDate?.getTime() ?? 0) - (b.responseDueDate?.getTime() ?? 0))
        .slice(0, 8)
        .map((o) => ({
          title: o.title,
          agency: o.agency,
          dueDate: o.responseDueDate!.toISOString().slice(0, 10),
        })),
    },
    proposals: {
      total: props.length,
      byStage: propByStage,
      inActiveReview: inActiveReviewRows.length,
    },
    modelTrack: track,
    lossIntel: loss
      ? {
          decided: loss.decided,
          winRate: loss.winRate,
          patterns: loss.patterns.slice(0, 4).map((p) => ({
            title: p.title,
            severity: p.severity,
            detail: p.detail.slice(0, 300),
          })),
          topCompetitors: loss.competitors.slice(0, 5).map((c) => ({ name: c.name, count: c.lostTo })),
        }
      : null,
  };
  const key = snapshotKeyOf({
    o: oppByStage,
    p: propByStage,
    t: opps.length,
    pt: props.length,
    r: inActiveReviewRows.length,
    day: now.toISOString().slice(0, 10),
    prompt: PIPELINE_BRIEF_PROMPT_VERSION,
  });
  return { snapshot, key };
}

export async function generatePipelineBrief(input: {
  organizationId: string;
  actor: { userId: string | null; email?: string | null };
  force?: boolean;
}): Promise<BriefResult & { snapshot?: PipelineSnapshot }> {
  const { organizationId } = input;
  const built = await buildPipelineSnapshot(organizationId);

  if (!input.force) {
    const last = await latestBrief({ organizationId, kind: "pipeline" });
    if (last && !last.stubbed && briefIsFresh(last, built.key)) {
      return { ok: true, brief: toStoredBrief(last), reused: true, snapshot: built.snapshot };
    }
  }

  const prompt = buildPipelineBriefPrompt(built.snapshot);
  const res = await completeStructuredForTenant({
    organizationId,
    feature: "pipeline_brief",
    promptVersion: PIPELINE_BRIEF_PROMPT_VERSION,
    schema: pipelineBriefSchema,
    toolName: "record_pipeline_brief",
    toolDescription: "Record the pipeline brief with its priorities and risks.",
    system: prompt.system,
    messages: prompt.messages,
    maxTokens: 1200,
    temperature: 0.3,
    cacheSystem: true,
  });
  const data = res.data;
  const text = (data?.brief ?? res.text ?? "").trim();
  if (!text) return { ok: false, error: res.parseError ?? "AI returned an empty brief." };

  const [row] = await db
    .insert(aiBriefs)
    .values({
      organizationId,
      kind: "pipeline",
      opportunityId: null,
      promptVersion: PIPELINE_BRIEF_PROMPT_VERSION,
      model: res.model,
      stubbed: res.stubbed,
      snapshotKey: built.key,
      snapshot: built.snapshot as unknown as Record<string, unknown>,
      text,
      signals: cleanList(data?.risks, 5),
      nextActions: cleanList(data?.priorities, 5),
      requestedByUserId: input.actor.userId,
    })
    .returning();
  if (!row) return { ok: false, error: "Could not store the brief." };

  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "pipeline.brief.generate",
    resourceType: "ai_brief",
    resourceId: row.id,
    metadata: { stubbed: row.stubbed, promptVersion: PIPELINE_BRIEF_PROMPT_VERSION },
  });
  return { ok: true, brief: toStoredBrief(row), reused: false, snapshot: built.snapshot };
}

// ── feedback and grading ──────────────────────────────────────────────

export async function setBriefFeedback(input: {
  organizationId: string;
  briefId: string;
  feedback: BriefFeedback;
  actor: { userId: string | null; email?: string | null };
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { organizationId } = input;
  const now = new Date();
  const [row] = await db
    .update(aiBriefs)
    .set({ feedback: input.feedback, feedbackUserId: input.actor.userId, feedbackAt: now })
    .where(and(eq(aiBriefs.id, input.briefId), eq(aiBriefs.organizationId, organizationId)))
    .returning({ id: aiBriefs.id, kind: aiBriefs.kind });
  if (!row) return { ok: false, error: "Brief not found." };
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "ai_brief.feedback",
    resourceType: "ai_brief",
    resourceId: row.id,
    metadata: { kind: row.kind, feedback: input.feedback },
  });
  return { ok: true };
}

/**
 * A closed pursuit grades every stored pursuit brief that made a call
 * on it and has not been graded yet.
 */
export async function gradeBriefsForOpportunity(input: {
  organizationId: string;
  opportunityId: string;
  outcome: BriefOutcome;
}): Promise<{ graded: number }> {
  const { organizationId, opportunityId } = input;
  const rows = await db
    .select({ id: aiBriefs.id, recommendation: aiBriefs.recommendation })
    .from(aiBriefs)
    .where(
      and(
        eq(aiBriefs.organizationId, organizationId),
        eq(aiBriefs.opportunityId, opportunityId),
        eq(aiBriefs.kind, "pursuit"),
        isNull(aiBriefs.gradedAt),
      ),
    );
  const now = new Date();
  for (const r of rows) {
    const grade = gradeRecommendation(isRecommendation(r.recommendation) ? r.recommendation : null, input.outcome);
    await db
      .update(aiBriefs)
      .set({ outcome: input.outcome, grade, gradedAt: now })
      .where(and(eq(aiBriefs.id, r.id), eq(aiBriefs.organizationId, organizationId)));
  }
  return { graded: rows.length };
}

/** How the pursuit briefs' calls have held up against outcomes. */
export async function getBriefTrack(input: { organizationId: string }): Promise<BriefTrack> {
  const { organizationId } = input;
  const rows = await db
    .select({ grade: aiBriefs.grade })
    .from(aiBriefs)
    .where(and(eq(aiBriefs.organizationId, organizationId), eq(aiBriefs.kind, "pursuit")))
    .limit(500);
  return summarizeBriefTrack(rows);
}
