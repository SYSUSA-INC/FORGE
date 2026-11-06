/**
 * BL-NAV-LIFECYCLE phase 2a — recording the Evaluate decision.
 *
 * `recordDecision` keeps each GO / NO-GO / PARTNER as its own row (a
 * changed decision is a new one) with the PWin and capability coverage at
 * that moment, moves the opportunity through the one stage-change path
 * (activity note, audit, the rules engine's no-bid event), and audits the
 * decision. A NO-GO closes the opportunity, which also stops the SAM.gov
 * amendment watch. `partnerSuggestions` lists the company's own teaming
 * partners and subcontractors whose NAICS codes match. Every query carries
 * organizationId; callers own auth. Server-only.
 */
import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { aiBriefs, companies, opportunities, opportunityCapabilityMatrices, opportunityDecisions, users, type OpportunityDecisionKind } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { computeCapabilityCoverage } from "@/lib/capability-coverage";
import { checkDecision, decisionNote, DECISION_STAGE, type DecisionInput } from "@/lib/opportunity-decision";
import { applyOpportunityStage } from "@/lib/opportunity-stage";

type Actor = { userId: string; email?: string | null };

/** The capability coverage (0..1) of the opportunity's questionnaire, or null when none is built or nothing is answered. */
export async function coverageOf(organizationId: string, opportunityId: string): Promise<number | null> {
  const [m] = await db
    .select({ questions: opportunityCapabilityMatrices.questions, answers: opportunityCapabilityMatrices.answers })
    .from(opportunityCapabilityMatrices)
    .where(and(eq(opportunityCapabilityMatrices.organizationId, organizationId), eq(opportunityCapabilityMatrices.opportunityId, opportunityId)))
    .limit(1);
  if (!m) return null;
  return computeCapabilityCoverage(m.questions ?? [], m.answers ?? {}).coverage;
}

export async function recordDecision(input: { organizationId: string; opportunityId: string; actor: Actor; decision: DecisionInput }): Promise<{ ok: true; decision: OpportunityDecisionKind } | { ok: false; error: string }> {
  const { organizationId, opportunityId } = input;
  const checked = checkDecision(input.decision);
  if (!checked.ok) return checked;
  const [opp] = await db
    .select({ id: opportunities.id, pWin: opportunities.pWin })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  if (!opp) return { ok: false, error: "Opportunity not found." };
  const coverage = await coverageOf(organizationId, opportunityId);
  const [row] = await db
    .insert(opportunityDecisions)
    .values({
      organizationId,
      opportunityId,
      decision: checked.decision,
      reasonCategory: checked.category,
      reason: checked.reason,
      pwin: opp.pWin,
      coverage,
      decidedByUserId: input.actor.userId,
    })
    .returning({ id: opportunityDecisions.id });
  await applyOpportunityStage({
    organizationId,
    opportunityId,
    stage: DECISION_STAGE[checked.decision],
    actor: input.actor,
    reasoning: decisionNote(checked),
    source: "gate_decision",
  });
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "opportunity.decision",
    resourceType: "opportunity",
    resourceId: opportunityId,
    metadata: { decisionId: row?.id ?? null, decision: checked.decision, category: checked.category, pwin: opp.pWin, coverage },
  });
  return { ok: true, decision: checked.decision };
}

export type DecisionView = { decision: OpportunityDecisionKind; category: string; reason: string; pwin: number | null; coverage: number | null; by: string | null; at: string };

/** Each opportunity's latest decision, for the Evaluate list. */
export async function latestDecisions(organizationId: string, opportunityIds: string[]): Promise<Map<string, DecisionView>> {
  const out = new Map<string, DecisionView>();
  if (opportunityIds.length === 0) return out;
  const rows = await db
    .select({ opportunityId: opportunityDecisions.opportunityId, decision: opportunityDecisions.decision, category: opportunityDecisions.reasonCategory, reason: opportunityDecisions.reason, pwin: opportunityDecisions.pwin, coverage: opportunityDecisions.coverage, by: users.name, at: opportunityDecisions.createdAt })
    .from(opportunityDecisions)
    .leftJoin(users, eq(users.id, opportunityDecisions.decidedByUserId))
    .where(and(eq(opportunityDecisions.organizationId, organizationId), inArray(opportunityDecisions.opportunityId, opportunityIds)))
    .orderBy(desc(opportunityDecisions.createdAt));
  for (const r of rows) if (!out.has(r.opportunityId)) out.set(r.opportunityId, { ...r, at: r.at.toISOString() });
  return out;
}

/** An opportunity's decisions, newest first (20 at most). */
export async function decisionHistory(organizationId: string, opportunityId: string): Promise<DecisionView[]> {
  const rows = await db
    .select({ decision: opportunityDecisions.decision, category: opportunityDecisions.reasonCategory, reason: opportunityDecisions.reason, pwin: opportunityDecisions.pwin, coverage: opportunityDecisions.coverage, by: users.name, at: opportunityDecisions.createdAt })
    .from(opportunityDecisions)
    .leftJoin(users, eq(users.id, opportunityDecisions.decidedByUserId))
    .where(and(eq(opportunityDecisions.organizationId, organizationId), eq(opportunityDecisions.opportunityId, opportunityId)))
    .orderBy(desc(opportunityDecisions.createdAt))
    .limit(20);
  return rows.map((r) => ({ ...r, at: r.at.toISOString() }));
}

export type EvaluateSignals = {
  /** The latest pursuit brief's call (pursue / watch / no_bid), or null before Analyze. */
  call: string | null;
  analysed: boolean;
  /** Questions in the capability matrix (0 before it is built). */
  questions: number;
  answered: number;
  coverage: number | null;
  decision: DecisionView | null;
};

/** What the Evaluate list shows for each opportunity: analysed or not, the matrix, the latest decision. */
export async function evaluateSignals(organizationId: string, opportunityIds: string[]): Promise<Map<string, EvaluateSignals>> {
  const out = new Map<string, EvaluateSignals>();
  if (opportunityIds.length === 0) return out;
  const [briefs, matrices, decisions] = await Promise.all([
    db
      .select({ opportunityId: aiBriefs.opportunityId, recommendation: aiBriefs.recommendation })
      .from(aiBriefs)
      .where(and(eq(aiBriefs.organizationId, organizationId), eq(aiBriefs.kind, "pursuit"), inArray(aiBriefs.opportunityId, opportunityIds)))
      .orderBy(desc(aiBriefs.createdAt)),
    db
      .select({ opportunityId: opportunityCapabilityMatrices.opportunityId, questions: opportunityCapabilityMatrices.questions, answers: opportunityCapabilityMatrices.answers })
      .from(opportunityCapabilityMatrices)
      .where(and(eq(opportunityCapabilityMatrices.organizationId, organizationId), inArray(opportunityCapabilityMatrices.opportunityId, opportunityIds))),
    latestDecisions(organizationId, opportunityIds),
  ]);
  const call = new Map<string, string | null>();
  for (const b of briefs) if (b.opportunityId && !call.has(b.opportunityId)) call.set(b.opportunityId, b.recommendation);
  const matrix = new Map(matrices.map((m) => [m.opportunityId, computeCapabilityCoverage(m.questions ?? [], m.answers ?? {})]));
  for (const id of opportunityIds) {
    const m = matrix.get(id);
    out.set(id, { call: call.get(id) ?? null, analysed: call.has(id), questions: m?.total ?? 0, answered: m?.answered ?? 0, coverage: m?.coverage ?? null, decision: decisions.get(id) ?? null });
  }
  return out;
}

export type PartnerSuggestion = { id: string; name: string; relationship: string; why: string };

/**
 * The company's own teaming partners and subcontractors that could cover a
 * gap: first those sharing the opportunity's NAICS code, then the rest of
 * the list, eight at most. FORGE's own partner finder is phase 3 (Capture).
 */
export async function partnerSuggestions(organizationId: string, opportunityId: string): Promise<PartnerSuggestion[]> {
  const [opp] = await db
    .select({ naics: opportunities.naicsCode })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  if (!opp) return [];
  const rows = await db
    .select({ id: companies.id, name: companies.name, relationship: companies.relationship, primary: companies.primaryNaics, list: companies.naicsList })
    .from(companies)
    .where(and(eq(companies.organizationId, organizationId), inArray(companies.relationship, ["teaming_partner", "subcontractor"])))
    .orderBy(companies.name)
    .limit(200);
  const code = (opp.naics.match(/\d{6}/) ?? [""])[0]!;
  const rel = (r: string) => (r === "teaming_partner" ? "teaming partner" : "subcontractor");
  const scored = rows.map((r) => {
    const codes = [r.primary, ...(r.list ?? [])].map((c) => (c.match(/\d{6}/) ?? [""])[0]).filter(Boolean);
    const same = !!code && codes.includes(code);
    return { r, same, why: same ? `Your ${rel(r.relationship)}; works under NAICS ${code}` : `Your ${rel(r.relationship)}` };
  });
  return scored
    .sort((a, b) => Number(b.same) - Number(a.same))
    .slice(0, 8)
    .map(({ r, why }) => ({ id: r.id, name: r.name, relationship: r.relationship, why }));
}
