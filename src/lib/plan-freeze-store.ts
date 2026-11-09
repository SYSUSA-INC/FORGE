import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { opportunities, opportunityActivities, opportunityDecisions, opportunityPlans, proposals } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { log } from "@/lib/log";
import { applyOpportunityStage } from "@/lib/opportunity-stage";
import { coverageOf, latestDecisions } from "@/lib/opportunity-decision-store";
import { developBlockers, developNote, DEVELOP_STAGE, frozenChangeNote, frozenState, type FrozenChange, type FrozenState } from "@/lib/plan-freeze-logic";
import { loadPlan } from "@/lib/plan-store";

/**
 * BL-NAV-LIFECYCLE 4c-2 — the freeze and Move to Develop (P-7, P-8).
 * Callers own the auth gate; every query scopes by organizationId.
 */
type Actor = { userId: string; email?: string | null; name?: string | null };
type Result = { ok: true } | { ok: false; error: string };

export type DevelopView = {
  stage: string;
  frozen: FrozenState;
  matrixFrozenAt: string | null;
  outlineFrozenAt: string | null;
  blockers: string[];
};

async function planOf(organizationId: string, opportunityId: string) {
  const [row] = await db
    .select({
      id: opportunityPlans.id,
      agreementStatus: opportunityPlans.agreementStatus,
      complianceMatrixFrozenAt: opportunityPlans.complianceMatrixFrozenAt,
      outlineFrozenAt: opportunityPlans.outlineFrozenAt,
    })
    .from(opportunityPlans)
    .where(and(eq(opportunityPlans.organizationId, organizationId), eq(opportunityPlans.opportunityId, opportunityId)))
    .limit(1);
  return row ?? null;
}

async function stageOf(organizationId: string, opportunityId: string) {
  const [opp] = await db
    .select({ stage: opportunities.stage, pWin: opportunities.pWin })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  return opp ?? null;
}

/** What stands between the plan and Develop, and the freeze stamps, for the Plan tab. */
export async function loadDevelopView(input: { organizationId: string; opportunityId: string; actor: Actor }): Promise<DevelopView | null> {
  const { organizationId, opportunityId } = input;
  const [plan, opp] = await Promise.all([loadPlan({ organizationId, opportunityId, actor: input.actor }), stageOf(organizationId, opportunityId)]);
  const row = await planOf(organizationId, opportunityId);
  if (!plan || !opp || !row) return null;
  const isPartner = (await latestDecisions(organizationId, [opportunityId])).get(opportunityId)?.decision === "partner";
  return {
    stage: opp.stage,
    frozen: frozenState(row),
    matrixFrozenAt: row.complianceMatrixFrozenAt ? row.complianceMatrixFrozenAt.toISOString() : null,
    outlineFrozenAt: row.outlineFrozenAt ? row.outlineFrozenAt.toISOString() : null,
    blockers: developBlockers({ stage: opp.stage, state: plan.state, frozen: frozenState(row), isPartner, agreementStatus: row.agreementStatus }),
  };
}

async function note(opportunityId: string, userId: string, title: string, body: string) {
  await db.insert(opportunityActivities).values({ opportunityId, userId, kind: "note", title, body, metadata: { source: "plan_freeze" } });
}

/** Stamps the compliance matrix and the outline; the Activity says so. Freezing a frozen plan leaves the first stamp. */
export async function freezePlan(input: { organizationId: string; opportunityId: string; actor: Actor; now?: Date }): Promise<Result> {
  const { organizationId, opportunityId } = input;
  if (!(await stageOf(organizationId, opportunityId))) return { ok: false, error: "Opportunity not found." };
  const plan = await planOf(organizationId, opportunityId);
  if (!plan) return { ok: false, error: "Open the plan first." };
  const now = input.now ?? new Date();
  const matrixAt = plan.complianceMatrixFrozenAt ?? now;
  const outlineAt = plan.outlineFrozenAt ?? now;
  await db
    .update(opportunityPlans)
    .set({ complianceMatrixFrozenAt: matrixAt, outlineFrozenAt: outlineAt, frozenByUserId: input.actor.userId, updatedAt: now })
    .where(and(eq(opportunityPlans.organizationId, organizationId), eq(opportunityPlans.id, plan.id)));
  await note(opportunityId, input.actor.userId, "Plan frozen", "The compliance matrix and the outline are frozen. A change to either from here on is noted on this timeline.");
  await recordAudit({ organizationId, actor: input.actor, action: "opportunity.plan.freeze", resourceType: "opportunity", resourceId: opportunityId, metadata: { planId: plan.id } });
  return { ok: true };
}

export async function unfreezePlan(input: { organizationId: string; opportunityId: string; actor: Actor }): Promise<Result> {
  const { organizationId, opportunityId } = input;
  const opp = await stageOf(organizationId, opportunityId);
  if (!opp) return { ok: false, error: "Opportunity not found." };
  const plan = await planOf(organizationId, opportunityId);
  if (!plan) return { ok: false, error: "Open the plan first." };
  await db
    .update(opportunityPlans)
    .set({ complianceMatrixFrozenAt: null, outlineFrozenAt: null, frozenByUserId: null, updatedAt: new Date() })
    .where(and(eq(opportunityPlans.organizationId, organizationId), eq(opportunityPlans.id, plan.id)));
  await note(opportunityId, input.actor.userId, "Plan unfrozen", "The compliance matrix and the outline were unfrozen; changes are no longer noted until the plan is frozen again.");
  await recordAudit({ organizationId, actor: input.actor, action: "opportunity.plan.unfreeze", resourceType: "opportunity", resourceId: opportunityId, metadata: { planId: plan.id } });
  return { ok: true };
}

/**
 * A change to the matrix or the outline of a proposal whose plan is
 * frozen is written to the opportunity's Activity. Best effort: it never
 * fails the change it describes, and a proposal with no opportunity, no
 * plan or no freeze writes nothing.
 */
export async function noteFrozenChange(input: { organizationId: string; proposalId: string; userId: string | null; change: FrozenChange }): Promise<void> {
  try {
    const { organizationId } = input;
    const [p] = await db
      .select({ opportunityId: proposals.opportunityId })
      .from(proposals)
      .where(and(eq(proposals.id, input.proposalId), eq(proposals.organizationId, organizationId)))
      .limit(1);
    if (!p?.opportunityId) return;
    const plan = await planOf(organizationId, p.opportunityId);
    const at = input.change.area === "matrix" ? plan?.complianceMatrixFrozenAt : plan?.outlineFrozenAt;
    if (!at) return;
    const n = frozenChangeNote(input.change, at.toISOString());
    await db.insert(opportunityActivities).values({ opportunityId: p.opportunityId, userId: input.userId, kind: "note", title: n.title, body: n.body, metadata: { source: "plan_freeze", area: input.change.area, action: input.change.action } });
  } catch (err) {
    log.warn("[noteFrozenChange]", "could not write the activity", { error: err });
  }
}

/** Move to Develop: records the plan decision and moves the stage, once nothing stands in the way. */
export async function moveToDevelop(input: { organizationId: string; opportunityId: string; actor: Actor }): Promise<Result> {
  const { organizationId, opportunityId } = input;
  const view = await loadDevelopView({ organizationId, opportunityId, actor: input.actor });
  const opp = await stageOf(organizationId, opportunityId);
  if (!view || !opp) return { ok: false, error: "Opportunity not found." };
  if (view.blockers.length > 0) return { ok: false, error: view.blockers[0]! };
  const plan = await loadPlan({ organizationId, opportunityId, actor: input.actor });
  const isPartner = (await latestDecisions(organizationId, [opportunityId])).get(opportunityId)?.decision === "partner";
  const milestones = plan?.state.milestones ?? 0;
  const reason = developNote({ isPartner, milestones });
  const coverage = await coverageOf(organizationId, opportunityId);
  const [row] = await db
    .insert(opportunityDecisions)
    .values({ organizationId, opportunityId, decision: "plan", reasonCategory: "", reason, pwin: opp.pWin, coverage, decidedByUserId: input.actor.userId })
    .returning({ id: opportunityDecisions.id });
  await applyOpportunityStage({ organizationId, opportunityId, stage: DEVELOP_STAGE, actor: { userId: input.actor.userId, email: input.actor.email }, reasoning: reason, source: "gate_decision" });
  await recordAudit({ organizationId, actor: input.actor, action: "opportunity.plan.move_to_develop", resourceType: "opportunity", resourceId: opportunityId, metadata: { decisionId: row?.id ?? null, milestones, isPartner } });
  return { ok: true };
}
