import "server-only";

import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import {
  complianceItems,
  opportunities,
  opportunityPlanRoles,
  opportunityPlans,
  proposalReviews,
  proposalSections,
  proposals,
  type ProposalWinTheme,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { isoDay } from "@/lib/milestone-logic";
import { developNextStep, developStateLine, leadsFromTeam, NO_READINESS, readiness, type DevelopNextStep, type DevelopState, type DraftLeads, type Readiness } from "@/lib/develop-logic";
import { normalizeCharter } from "@/lib/plan-charter-logic";

/**
 * BL-NAV-LIFECYCLE 5a (FORGE II D-1, D-3) — Develop's store: what Create a
 * Draft takes from the plan, and the draft's readiness for Pink. The
 * proposal's sections, reviews and compliance rows carry no
 * organization_id, so every query joins the proposal and filters on the
 * organization. Callers own the auth gate.
 */

type Actor = { userId: string; email?: string | null; name?: string | null };

export type DevelopView = {
  opportunityId: string;
  opportunityTitle: string;
  proposal: { id: string; title: string } | null;
  readiness: Readiness;
  nextReview: DevelopState["nextReview"];
  state: DevelopState;
  nextStep: DevelopNextStep;
  /** What Create a Draft will take from the plan, for the tab to say before the click. */
  plan: { leads: DraftLeads; winThemes: number; signed: boolean; frozen: boolean } | null;
};

/** The newest proposal of the opportunity, or null. */
export async function draftProposalOf(organizationId: string, opportunityId: string) {
  const [row] = await db
    .select({ id: proposals.id, title: proposals.title, winThemes: proposals.winThemes })
    .from(proposals)
    .where(and(eq(proposals.organizationId, organizationId), eq(proposals.opportunityId, opportunityId)))
    .orderBy(desc(proposals.createdAt))
    .limit(1);
  return row ?? null;
}

/** What the plan hands the new draft: the leads, the charter's win themes, whether the charter is signed and the plan frozen. */
export async function planInputs(organizationId: string, opportunityId: string) {
  const [plan] = await db
    .select({ charter: opportunityPlans.charter, charterSignedAt: opportunityPlans.charterSignedAt, outlineFrozenAt: opportunityPlans.outlineFrozenAt })
    .from(opportunityPlans)
    .where(and(eq(opportunityPlans.organizationId, organizationId), eq(opportunityPlans.opportunityId, opportunityId)))
    .limit(1);
  const team = await db
    .select({ userId: opportunityPlanRoles.userId, role: opportunityPlanRoles.role, raci: opportunityPlanRoles.raci })
    .from(opportunityPlanRoles)
    .where(and(eq(opportunityPlanRoles.organizationId, organizationId), eq(opportunityPlanRoles.opportunityId, opportunityId)))
    .orderBy(asc(opportunityPlanRoles.assignedAt));
  const themes: ProposalWinTheme[] = plan?.charterSignedAt ? (normalizeCharter(plan.charter).winThemes ?? []).map((t) => ({ title: t.title, statement: t.statement })) : [];
  return { leads: leadsFromTeam(team), winThemes: themes, signed: !!plan?.charterSignedAt, frozen: !!plan?.outlineFrozenAt };
}

/** Writes the charter's win themes to a new draft that has none; returns how many were written. */
export async function seedWinThemes(organizationId: string, proposalId: string, themes: ProposalWinTheme[]): Promise<number> {
  if (themes.length === 0) return 0;
  const [p] = await db.select({ winThemes: proposals.winThemes }).from(proposals).where(and(eq(proposals.organizationId, organizationId), eq(proposals.id, proposalId))).limit(1);
  if (!p || (p.winThemes ?? []).length > 0) return 0;
  await db.update(proposals).set({ winThemes: themes }).where(and(eq(proposals.organizationId, organizationId), eq(proposals.id, proposalId)));
  return themes.length;
}

/** Audit of Create a Draft. */
export async function auditDraftCreate(input: { organizationId: string; actor: Actor; opportunityId: string; proposalId: string; metadata: Record<string, unknown> }) {
  await recordAudit({
    organizationId: input.organizationId,
    actor: input.actor,
    action: "opportunity.develop.draft_create",
    resourceType: "opportunity",
    resourceId: input.opportunityId,
    metadata: { proposalId: input.proposalId, ...input.metadata },
  });
}

/** Readiness per proposal id, in two queries for any number of proposals. */
async function readinessByProposal(organizationId: string, proposalIds: string[]): Promise<Map<string, Readiness>> {
  const out = new Map<string, Readiness>();
  if (proposalIds.length === 0) return out;
  const [sections, items] = await Promise.all([
    db
      .select({ proposalId: proposalSections.proposalId, title: proposalSections.title, status: proposalSections.status, content: proposalSections.content, wordCount: proposalSections.wordCount })
      .from(proposalSections)
      .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
      .where(and(eq(proposals.organizationId, organizationId), inArray(proposalSections.proposalId, proposalIds)))
      .orderBy(asc(proposalSections.ordering)),
    db
      .select({ proposalId: complianceItems.proposalId, mapped: isNotNull(complianceItems.proposalSectionId) })
      .from(complianceItems)
      .innerJoin(proposals, eq(proposals.id, complianceItems.proposalId))
      .where(and(eq(proposals.organizationId, organizationId), inArray(complianceItems.proposalId, proposalIds))),
  ]);
  for (const id of proposalIds) {
    out.set(
      id,
      readiness(
        sections.filter((s) => s.proposalId === id),
        items.filter((i) => i.proposalId === id).map((i) => ({ mapped: !!i.mapped })),
      ),
    );
  }
  return out;
}

/** The newest review round per proposal id. */
async function nextReviewByProposal(organizationId: string, proposalIds: string[]): Promise<Map<string, NonNullable<DevelopState["nextReview"]>>> {
  const out = new Map<string, NonNullable<DevelopState["nextReview"]>>();
  if (proposalIds.length === 0) return out;
  const rows = await db
    .select({ proposalId: proposalReviews.proposalId, color: proposalReviews.color, status: proposalReviews.status, dueDate: proposalReviews.dueDate })
    .from(proposalReviews)
    .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
    .where(and(eq(proposals.organizationId, organizationId), inArray(proposalReviews.proposalId, proposalIds)))
    .orderBy(desc(proposalReviews.createdAt));
  for (const r of rows) if (!out.has(r.proposalId)) out.set(r.proposalId, { color: r.color, status: r.status, date: r.dueDate ? isoDay(r.dueDate) : null });
  return out;
}

/** The draft's state per opportunity, for Pipeline → Develop. Opportunities with no proposal read as "no draft yet". */
export async function developSummaries(organizationId: string, opportunityIds: string[]): Promise<Map<string, { state: DevelopState; step: DevelopNextStep; line: string }>> {
  const out = new Map<string, { state: DevelopState; step: DevelopNextStep; line: string }>();
  if (opportunityIds.length === 0) return out;
  const props = await db
    .select({ id: proposals.id, opportunityId: proposals.opportunityId })
    .from(proposals)
    .where(and(eq(proposals.organizationId, organizationId), inArray(proposals.opportunityId, opportunityIds)))
    .orderBy(asc(proposals.createdAt));
  const newest = new Map<string, string>();
  for (const p of props) if (p.opportunityId) newest.set(p.opportunityId, p.id);
  const ids = [...newest.values()];
  const [ready, reviews] = await Promise.all([readinessByProposal(organizationId, ids), nextReviewByProposal(organizationId, ids)]);
  for (const oppId of opportunityIds) {
    const pid = newest.get(oppId);
    const state: DevelopState = pid ? { hasProposal: true, readiness: ready.get(pid) ?? NO_READINESS, nextReview: reviews.get(pid) ?? null } : { hasProposal: false, readiness: NO_READINESS, nextReview: null };
    out.set(oppId, { state, step: developNextStep(state), line: developStateLine(state) });
  }
  return out;
}

/** The Develop tab's view; null when the opportunity is not the tenant's. */
export async function loadDevelop(input: { organizationId: string; opportunityId: string }): Promise<DevelopView | null> {
  const { organizationId, opportunityId } = input;
  const [opp] = await db
    .select({ title: opportunities.title })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  if (!opp) return null;
  const proposal = await draftProposalOf(organizationId, opportunityId);
  const summary = (await developSummaries(organizationId, [opportunityId])).get(opportunityId)!;
  const inputs = proposal ? null : await planInputs(organizationId, opportunityId);
  return {
    opportunityId,
    opportunityTitle: opp.title,
    proposal: proposal ? { id: proposal.id, title: proposal.title } : null,
    readiness: summary.state.readiness,
    nextReview: summary.state.nextReview,
    state: summary.state,
    nextStep: summary.step,
    plan: inputs ? { leads: inputs.leads, winThemes: inputs.winThemes.length, signed: inputs.signed, frozen: inputs.frozen } : null,
  };
}
