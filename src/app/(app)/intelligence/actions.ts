"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  opportunities,
  organizations,
  proposalReviews,
  proposals,
  type OpportunityStage,
  type ProposalStage,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import {
  STAGE_LABELS as OPP_STAGE_LABELS,
} from "@/lib/opportunity-types";
import {
  STAGE_LABELS as PROP_STAGE_LABELS,
} from "@/lib/proposal-types";
import { complete, getAIProviderStatus } from "@/lib/ai";
import {
  buildPipelineBriefPrompt,
  type PipelineSnapshot,
} from "@/lib/ai-prompts";

export type PipelineBriefResult = {
  ok: true;
  text: string;
  provider: string;
  model: string;
  stubbed: boolean;
  inputTokens?: number;
  outputTokens?: number;
  generatedAt: string;
  snapshot: PipelineSnapshot;
};

export type PipelineBriefError = { ok: false; error: string };

const briefCache = new Map<
  string,
  { result: PipelineBriefResult; expiresAt: number }
>();
const CACHE_TTL_MS = 5 * 60_000;

function snapshotKey(snapshot: PipelineSnapshot): string {
  return JSON.stringify({
    o: snapshot.opportunities.byStage,
    p: snapshot.proposals.byStage,
    t: snapshot.opportunities.total,
    pt: snapshot.proposals.total,
  });
}

async function buildSnapshot(
  organizationId: string,
): Promise<PipelineSnapshot> {
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
    .select({
      id: proposals.id,
      stage: proposals.stage,
    })
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

  const liveOpps = opps.filter(
    (o) => !["won", "lost", "no_bid"].includes(o.stage),
  );

  const topByPwin = [...liveOpps]
    .filter((o) => typeof o.pWin === "number" && o.pWin > 0)
    .sort((a, b) => (b.pWin ?? 0) - (a.pWin ?? 0))
    .slice(0, 5)
    .map((o) => ({
      title: o.title,
      agency: o.agency,
      stage: OPP_STAGE_LABELS[o.stage as OpportunityStage] ?? o.stage,
      pwin: o.pWin ?? null,
      dueDate: o.responseDueDate
        ? o.responseDueDate.toISOString().slice(0, 10)
        : null,
    }));

  const now = new Date();
  const fortnight = new Date(now.getTime() + 14 * 24 * 60 * 60_000);
  const upcomingDueWithin14Days = liveOpps
    .filter(
      (o) =>
        o.responseDueDate &&
        o.responseDueDate >= now &&
        o.responseDueDate <= fortnight,
    )
    .sort(
      (a, b) =>
        (a.responseDueDate?.getTime() ?? 0) -
        (b.responseDueDate?.getTime() ?? 0),
    )
    .slice(0, 8)
    .map((o) => ({
      title: o.title,
      agency: o.agency,
      dueDate: o.responseDueDate!.toISOString().slice(0, 10),
    }));

  const inActiveReviewRows = await db
    .select({ id: proposalReviews.id })
    .from(proposalReviews)
    .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
    .where(
      and(
        eq(proposals.organizationId, organizationId),
        eq(proposalReviews.status, "in_progress"),
      ),
    );

  return {
    organizationName: org?.name ?? "your organization",
    asOf: now.toISOString().slice(0, 10),
    opportunities: {
      total: opps.length,
      byStage: oppByStage,
      topByPwin,
      upcomingDueWithin14Days,
    },
    proposals: {
      total: props.length,
      byStage: propByStage,
      inActiveReview: inActiveReviewRows.length,
    },
  };
}

export async function generatePipelineBriefAction(
  options: { force?: boolean } = {},
): Promise<PipelineBriefResult | PipelineBriefError> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const snapshot = await buildSnapshot(organizationId);
  const key = `${organizationId}::${snapshotKey(snapshot)}`;

  if (!options.force) {
    const cached = briefCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }
  }

  try {
    const prompt = buildPipelineBriefPrompt(snapshot);
    const ai = await complete({
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: 600,
      temperature: 0.4,
      cacheSystem: true,
    });

    const result: PipelineBriefResult = {
      ok: true,
      text: ai.text,
      provider: ai.provider,
      model: ai.model,
      stubbed: ai.stubbed,
      inputTokens: ai.inputTokens,
      outputTokens: ai.outputTokens,
      generatedAt: new Date().toISOString(),
      snapshot,
    };

    briefCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch (err) {
    console.error("[generatePipelineBriefAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "AI request failed.",
    };
  }
}

export async function getProviderStatusAction() {
  await requireAuth();
  return getAIProviderStatus();
}
