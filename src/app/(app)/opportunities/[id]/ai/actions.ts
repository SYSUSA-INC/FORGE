"use server";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  opportunities,
  opportunityActivities,
  opportunityCompetitors,
  opportunityEvaluations,
  organizations,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { complete } from "@/lib/ai";
import {
  buildOpportunityBriefPrompt,
  type OpportunitySnapshot,
} from "@/lib/ai-prompts";
import { STAGE_LABELS } from "@/lib/opportunity-types";

export type OpportunityBriefResult = {
  ok: true;
  text: string;
  provider: string;
  model: string;
  stubbed: boolean;
  inputTokens?: number;
  outputTokens?: number;
  generatedAt: string;
};

export type OpportunityBriefError = { ok: false; error: string };

const briefCache = new Map<
  string,
  { result: OpportunityBriefResult; expiresAt: number }
>();
const CACHE_TTL_MS = 5 * 60_000;

function snapshotKey(snapshot: OpportunitySnapshot): string {
  return JSON.stringify({
    s: snapshot.opportunity.stage,
    p: snapshot.opportunity.pwin,
    d: snapshot.opportunity.daysToDue,
    e: snapshot.evaluation?.rollupScore ?? null,
    c: snapshot.competitors.length,
    a: snapshot.recentActivity.length,
  });
}

async function buildSnapshot(
  opportunityId: string,
  organizationId: string,
): Promise<OpportunitySnapshot | null> {
  const [oppRow] = await db
    .select()
    .from(opportunities)
    .where(
      and(
        eq(opportunities.id, opportunityId),
        eq(opportunities.organizationId, organizationId),
      ),
    )
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
    ? Math.ceil(
        (oppRow.responseDueDate.getTime() - now.getTime()) /
          (24 * 60 * 60_000),
      )
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
    const sum = dims.reduce((a, b) => a + b, 0);
    rollup = Math.round(sum / dims.length);
  }

  return {
    organizationName: orgRow?.name ?? "your organization",
    asOf: now.toISOString().slice(0, 10),
    opportunity: {
      title: oppRow.title,
      agency: oppRow.agency,
      office: oppRow.office,
      stage: STAGE_LABELS[oppRow.stage] ?? oppRow.stage,
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
      daysAgo: Math.max(
        0,
        Math.round(
          (now.getTime() - a.createdAt.getTime()) / (24 * 60 * 60_000),
        ),
      ),
    })),
  };
}

export async function generateOpportunityBriefAction(
  opportunityId: string,
  options: { force?: boolean } = {},
): Promise<OpportunityBriefResult | OpportunityBriefError> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const snapshot = await buildSnapshot(opportunityId, organizationId);
  if (!snapshot) return { ok: false, error: "Opportunity not found." };

  const key = `${organizationId}::${opportunityId}::${snapshotKey(snapshot)}`;

  if (!options.force) {
    const cached = briefCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }
  }

  try {
    const prompt = buildOpportunityBriefPrompt(snapshot);
    const ai = await complete({
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: 600,
      temperature: 0.4,
      cacheSystem: true,
    });

    const result: OpportunityBriefResult = {
      ok: true,
      text: ai.text,
      provider: ai.provider,
      model: ai.model,
      stubbed: ai.stubbed,
      inputTokens: ai.inputTokens,
      outputTokens: ai.outputTokens,
      generatedAt: new Date().toISOString(),
    };
    briefCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  } catch (err) {
    console.error("[generateOpportunityBriefAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "AI request failed.",
    };
  }
}
