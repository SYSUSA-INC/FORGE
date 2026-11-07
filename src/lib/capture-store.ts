import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { companies, opportunities, opportunityPartners, users, type OpportunityPartnerStatus } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { emptyPartnerCounts, planBlocker, planNote, PLAN_STAGE, type PartnerCounts } from "@/lib/capture-logic";
import { latestDecisions } from "@/lib/opportunity-decision-store";
import { applyOpportunityStage } from "@/lib/opportunity-stage";

/**
 * BL-NAV-LIFECYCLE phase 3a — the partners considered for an opportunity
 * in Capture, choosing them, and Move to Plan. Every query carries
 * organizationId, and a partner must be one of the organization's own
 * companies on one of its own opportunities. Callers own auth.
 */
type Actor = { userId: string; email?: string | null };

export type PartnerRow = {
  id: string;
  companyId: string;
  name: string;
  relationship: string;
  uei: string;
  source: string;
  status: OpportunityPartnerStatus;
  reason: string;
  chosenAt: string | null;
  chosenBy: string | null;
};

async function ownOpportunity(organizationId: string, opportunityId: string) {
  const [opp] = await db
    .select({ id: opportunities.id, stage: opportunities.stage, title: opportunities.title })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  return opp ?? null;
}

export async function listOpportunityPartners(organizationId: string, opportunityId: string): Promise<PartnerRow[]> {
  const rows = await db
    .select({
      id: opportunityPartners.id,
      companyId: companies.id,
      name: companies.name,
      relationship: companies.relationship,
      uei: companies.uei,
      source: opportunityPartners.source,
      status: opportunityPartners.status,
      reason: opportunityPartners.reason,
      chosenAt: opportunityPartners.chosenAt,
      chosenBy: users.name,
    })
    .from(opportunityPartners)
    .innerJoin(companies, and(eq(companies.id, opportunityPartners.companyId), eq(companies.organizationId, organizationId)))
    .leftJoin(users, eq(users.id, opportunityPartners.chosenByUserId))
    .where(and(eq(opportunityPartners.organizationId, organizationId), eq(opportunityPartners.opportunityId, opportunityId)))
    .orderBy(asc(companies.name));
  return rows.map((r) => ({ ...r, chosenAt: r.chosenAt ? r.chosenAt.toISOString() : null }));
}

/** Each opportunity's partner counts by status, and the chosen partners' names. */
export async function partnerSummaries(organizationId: string, opportunityIds: string[]): Promise<Map<string, { counts: PartnerCounts; chosen: string[] }>> {
  const out = new Map<string, { counts: PartnerCounts; chosen: string[] }>();
  if (opportunityIds.length === 0) return out;
  const rows = await db
    .select({ opportunityId: opportunityPartners.opportunityId, status: opportunityPartners.status, name: companies.name })
    .from(opportunityPartners)
    .innerJoin(companies, eq(companies.id, opportunityPartners.companyId))
    .where(and(eq(opportunityPartners.organizationId, organizationId), inArray(opportunityPartners.opportunityId, opportunityIds)));
  for (const r of rows) {
    const s = out.get(r.opportunityId) ?? { counts: emptyPartnerCounts(), chosen: [] };
    s.counts[r.status] += 1;
    if (r.status === "chosen") s.chosen.push(r.name);
    out.set(r.opportunityId, s);
  }
  return out;
}

/** Adds one of the organization's companies as a candidate partner (again: no change). */
export async function addPartnerCandidate(input: { organizationId: string; opportunityId: string; companyId: string; actor: Actor; source?: string; reason?: string }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { organizationId } = input;
  if (!(await ownOpportunity(organizationId, input.opportunityId))) return { ok: false, error: "Opportunity not found." };
  const [company] = await db
    .select({ id: companies.id, name: companies.name })
    .from(companies)
    .where(and(eq(companies.id, input.companyId), eq(companies.organizationId, organizationId)))
    .limit(1);
  if (!company) return { ok: false, error: "Company not found." };
  const [row] = await db
    .insert(opportunityPartners)
    .values({ organizationId, opportunityId: input.opportunityId, companyId: company.id, source: input.source ?? "own", reason: (input.reason ?? "").slice(0, 500), createdByUserId: input.actor.userId })
    .onConflictDoNothing()
    .returning({ id: opportunityPartners.id });
  if (!row) {
    const [existing] = await db
      .select({ id: opportunityPartners.id })
      .from(opportunityPartners)
      .where(and(eq(opportunityPartners.organizationId, organizationId), eq(opportunityPartners.opportunityId, input.opportunityId), eq(opportunityPartners.companyId, company.id)))
      .limit(1);
    return { ok: true, id: existing!.id };
  }
  await recordAudit({ organizationId, actor: input.actor, action: "opportunity.partner.add", resourceType: "opportunity", resourceId: input.opportunityId, metadata: { partnerId: row.id, companyId: company.id, company: company.name, source: input.source ?? "own" } });
  return { ok: true, id: row.id };
}

/** Choose, decline or put back a partner. Several can be chosen (a team). */
export async function setPartnerStatus(input: { organizationId: string; opportunityId: string; partnerId: string; status: "chosen" | "declined" | "candidate"; actor: Actor }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { organizationId } = input;
  const now = new Date();
  const [row] = await db
    .update(opportunityPartners)
    .set({
      status: input.status,
      chosenByUserId: input.status === "chosen" ? input.actor.userId : null,
      chosenAt: input.status === "chosen" ? now : null,
      updatedAt: now,
    })
    .where(and(eq(opportunityPartners.id, input.partnerId), eq(opportunityPartners.organizationId, organizationId), eq(opportunityPartners.opportunityId, input.opportunityId)))
    .returning({ id: opportunityPartners.id, companyId: opportunityPartners.companyId });
  if (!row) return { ok: false, error: "Partner not found." };
  await recordAudit({ organizationId, actor: input.actor, action: `opportunity.partner.${input.status === "candidate" ? "reconsider" : input.status === "chosen" ? "choose" : "decline"}`, resourceType: "opportunity", resourceId: input.opportunityId, metadata: { partnerId: row.id, companyId: row.companyId } });
  return { ok: true };
}

export async function removePartner(input: { organizationId: string; opportunityId: string; partnerId: string; actor: Actor }): Promise<{ ok: true } | { ok: false; error: string }> {
  const [row] = await db
    .delete(opportunityPartners)
    .where(and(eq(opportunityPartners.id, input.partnerId), eq(opportunityPartners.organizationId, input.organizationId), eq(opportunityPartners.opportunityId, input.opportunityId)))
    .returning({ id: opportunityPartners.id, companyId: opportunityPartners.companyId });
  if (!row) return { ok: false, error: "Partner not found." };
  await recordAudit({ organizationId: input.organizationId, actor: input.actor, action: "opportunity.partner.remove", resourceType: "opportunity", resourceId: input.opportunityId, metadata: { partnerId: row.id, companyId: row.companyId } });
  return { ok: true };
}

/** Move to Plan (stage Captured), through the one stage-change path, once nothing stands in the way. */
export async function moveToPlan(input: { organizationId: string; opportunityId: string; actor: Actor }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { organizationId, opportunityId } = input;
  const opp = await ownOpportunity(organizationId, opportunityId);
  if (!opp) return { ok: false, error: "Opportunity not found." };
  const decision = (await latestDecisions(organizationId, [opportunityId])).get(opportunityId)?.decision ?? null;
  const summary = (await partnerSummaries(organizationId, [opportunityId])).get(opportunityId);
  const blocker = planBlocker({ stage: opp.stage, decision, chosen: summary?.counts.chosen ?? 0 });
  if (blocker) return { ok: false, error: blocker };
  await applyOpportunityStage({ organizationId, opportunityId, stage: PLAN_STAGE, actor: input.actor, reasoning: planNote({ decision, chosenNames: summary?.chosen ?? [] }), source: "gate_decision" });
  return { ok: true };
}

/** The companies of the organization not yet considered for this opportunity, teaming partners and subcontractors first. */
export async function companiesToConsider(organizationId: string, opportunityId: string): Promise<{ id: string; name: string; relationship: string }[]> {
  return db
    .select({ id: companies.id, name: companies.name, relationship: companies.relationship })
    .from(companies)
    .where(
      and(
        eq(companies.organizationId, organizationId),
        sql`${companies.id} NOT IN (SELECT ${opportunityPartners.companyId} FROM ${opportunityPartners} WHERE ${opportunityPartners.organizationId} = ${organizationId} AND ${opportunityPartners.opportunityId} = ${opportunityId})`,
      ),
    )
    .orderBy(sql`CASE WHEN ${companies.relationship} IN ('teaming_partner', 'subcontractor') THEN 0 ELSE 1 END`, asc(companies.name))
    .limit(300);
}
