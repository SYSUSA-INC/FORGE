import "server-only";

import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { opportunities, opportunityCapabilityMatrices, opportunityCompetitors, organizations, solicitations } from "@/db/schema";
import { completeStructuredForTenant, getAIProviderStatus } from "@/lib/ai";
import { analysisReportSchema, ANALYSIS_REPORT_PROMPT_VERSION, buildAnalysisReportPrompt, type AnalysisPromptInput } from "@/lib/analysis-report-prompt";
import { isRecommendation } from "@/lib/brief-logic";
import { generatePursuitBrief } from "@/lib/briefs";
import { computeCapabilityCoverage } from "@/lib/capability-coverage";
import { log } from "@/lib/log";
import { buildAnalysisReport, factsOnlyAnalysis, type AnalysisCall } from "@/lib/opportunity-report";
import { insertReport } from "@/lib/opportunity-report-store";
import { computePwin } from "@/lib/pwin";
import { enforceQuota, ensureFeature, FeatureGateError, QuotaExceededError, refundQuota } from "@/lib/subscription-gates";

/**
 * BL-NAV-LIFECYCLE phase 2c (FORGE II footnote 5, E-3, E-4) — Analyze: in
 * one go, the calibrated PWin (no AI), the pursuit brief (reused while
 * fresh, else written), and one AI call that ties them, the capability
 * matrix and the competitors into the Analysis Report, kept as the next
 * version on the opportunity. The AI call is under the plan's AI switch
 * and monthly quota (refunded if it fails); with no AI provider the report
 * is written from the facts alone and says so. Callers own auth.
 */
export async function runAnalysis(input: { organizationId: string; opportunityId: string; actor: { userId: string; email?: string | null }; now?: Date }): Promise<{ ok: true; id: string; version: number } | { ok: false; error: string }> {
  const { organizationId, opportunityId } = input;
  const [opp] = await db
    .select({
      title: opportunities.title,
      agency: opportunities.agency,
      solicitationNumber: opportunities.solicitationNumber,
      naics: opportunities.naicsCode,
      setAside: opportunities.setAside,
      due: opportunities.responseDueDate,
      valueLow: opportunities.valueLow,
      valueHigh: opportunities.valueHigh,
      incumbent: opportunities.incumbent,
      stage: opportunities.stage,
      description: opportunities.description,
    })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  if (!opp) return { ok: false, error: "Opportunity not found." };

  const live = getAIProviderStatus().active.name !== "stub";
  if (live) {
    try {
      await ensureFeature(organizationId, "aiAutoDraft");
      await enforceQuota(organizationId, "aiRequestsPerMonth");
    } catch (err) {
      if (err instanceof FeatureGateError || err instanceof QuotaExceededError) return { ok: false, error: err.message };
      throw err;
    }
  }

  const [pwinEst, briefRes, [matrix], competitors, [org], [docs]] = await Promise.all([
    computePwin(organizationId, opportunityId).catch((err) => {
      log.warn("[analysis]", "pwin failed", { opportunityId, error: err instanceof Error ? err.message : err });
      return null;
    }),
    generatePursuitBrief({ organizationId, opportunityId, actor: input.actor }).catch((err) => ({ ok: false as const, error: err instanceof Error ? err.message : "brief failed" })),
    db
      .select({ questions: opportunityCapabilityMatrices.questions, answers: opportunityCapabilityMatrices.answers })
      .from(opportunityCapabilityMatrices)
      .where(and(eq(opportunityCapabilityMatrices.organizationId, organizationId), eq(opportunityCapabilityMatrices.opportunityId, opportunityId)))
      .limit(1),
    // The opportunity was checked as this organization's above.
    db
      .select({ name: opportunityCompetitors.name, incumbent: opportunityCompetitors.isIncumbent, strengths: opportunityCompetitors.strengths, weaknesses: opportunityCompetitors.weaknesses })
      .from(opportunityCompetitors)
      .where(eq(opportunityCompetitors.opportunityId, opportunityId))
      .limit(20),
    db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, organizationId)).limit(1),
    db.select({ n: count() }).from(solicitations).where(and(eq(solicitations.organizationId, organizationId), eq(solicitations.opportunityId, opportunityId))),
  ]);

  const pwin = pwinEst ? { pwin: pwinEst.score.pwin, confidence: pwinEst.score.confidence, factors: pwinEst.score.factors.map((f) => ({ label: f.label, logOdds: Math.round(f.logOdds * 100) / 100, detail: f.detail })) } : null;
  const brief = briefRes.ok ? briefRes.brief : null;
  const cov = matrix && matrix.questions.length > 0 ? computeCapabilityCoverage(matrix.questions, matrix.answers ?? {}) : null;
  const now = input.now ?? new Date();
  const opportunity = { title: opp.title, agency: opp.agency, solicitationNumber: opp.solicitationNumber, naics: opp.naics, dueDate: opp.due ? opp.due.toISOString() : null };

  const sources = [
    pwin ? `PWin model ${pwinEst?.modelVersion ?? ""}`.trim() + ` (${pwin.factors.length} factor${pwin.factors.length === 1 ? "" : "s"})` : "PWin model: not available",
    brief ? `AI pursuit brief of ${brief.createdAt.slice(0, 10)}${brief.recommendation ? ` (${brief.recommendation})` : ""}` : "AI pursuit brief: not available",
    cov ? `Capability matrix: ${cov.answered} of ${cov.total} answered` : "Capability matrix: not built",
    `Competitors logged: ${competitors.length}`,
    `Solicitation documents on the opportunity: ${docs?.n ?? 0}`,
  ];

  const facts: AnalysisPromptInput = {
    organizationName: org?.name ?? "the company",
    asOf: now.toISOString().slice(0, 10),
    opportunity: { ...opportunity, setAside: opp.setAside, valueLow: String(opp.valueLow ?? ""), valueHigh: String(opp.valueHigh ?? ""), incumbent: opp.incumbent, stage: opp.stage, description: opp.description },
    pwin,
    brief: brief ? { recommendation: brief.recommendation, confidence: brief.confidence, text: brief.text, signals: brief.signals, nextActions: brief.nextActions } : null,
    capability: cov ? { coverage: cov.coverage, answered: cov.answered, total: cov.total, partnerNeeded: cov.partnerNeeded, gaps: cov.gaps.map((g) => g.text).slice(0, 10) } : null,
    competitors: competitors.map((c) => ({ name: c.name, incumbent: c.incumbent, strengths: c.strengths.slice(0, 300), weaknesses: c.weaknesses.slice(0, 300) })),
  };
  const briefCall: AnalysisCall | null = brief?.recommendation && isRecommendation(brief.recommendation) ? brief.recommendation : null;
  const fallback = () =>
    factsOnlyAnalysis({ pwin, briefCall, coverage: cov?.coverage ?? null, partnerNeeded: !!cov?.partnerNeeded, gaps: cov?.gaps.map((g) => g.text) ?? [], competitors, incumbent: opp.incumbent });

  let ai: ReturnType<typeof fallback>;
  let stubbed = !live;
  let model = "";
  if (!live) {
    ai = fallback();
  } else {
    const prompt = buildAnalysisReportPrompt(facts);
    const res = await completeStructuredForTenant({
      organizationId,
      feature: "analysis_report",
      promptVersion: ANALYSIS_REPORT_PROMPT_VERSION,
      schema: analysisReportSchema,
      toolName: "record_analysis_report",
      toolDescription: "Record the Analysis Report: the call, the summary, and the fit, competition, risk and raise-PWin lines.",
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: 1800,
      temperature: 0.2,
      cacheSystem: true,
    }).catch(async (err) => {
      await refundQuota(organizationId, "aiRequestsPerMonth").catch(() => undefined);
      throw err;
    });
    if (!res.data) {
      await refundQuota(organizationId, "aiRequestsPerMonth").catch(() => undefined);
      return { ok: false, error: res.parseError ? `The AI's report could not be read (${res.parseError}). Try again.` : "The AI returned no report. Try again." };
    }
    ai = res.data;
    stubbed = res.stubbed;
    model = res.model;
  }

  const body = buildAnalysisReport({ opportunity, pwin, ai, sources, stubbed, model, now });
  return insertReport({
    organizationId,
    opportunityId,
    kind: "analysis",
    body: body as unknown as Record<string, unknown>,
    actor: input.actor,
    audit: { call: body.call, pwin: pwin?.pwin ?? null, stubbed, promptVersion: ANALYSIS_REPORT_PROMPT_VERSION },
  });
}
