import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { opportunities, opportunityPlans, proposals, solicitations, users, type PlanCharter, type PlanRisk, type SolicitationKeyDate } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { latestDecisions } from "@/lib/opportunity-decision-store";
import {
  agreementProblem,
  charterBlockers,
  charterStatus,
  normalizeCharter,
  normalizeRisks,
  parseEstimate,
  resolveCutoff,
  sameCharter,
  MAX_BUDGET_DOLLARS,
  MAX_BUDGET_HOURS,
  MAX_WIN_THEMES,
  type AgreementStatus,
  type CharterStatus,
  type CutoffKind,
} from "@/lib/plan-charter-logic";

/**
 * BL-NAV-LIFECYCLE 4c-1 — the Plan's charter and sign-off, the agreement
 * kept by hand, the bid budget estimate, the cut-off dates and the risk
 * list, all on the opportunity's plan. Callers own the auth gate; every
 * function scopes by organizationId.
 */

type Actor = { userId: string; email?: string | null; name?: string | null };
type Result = { ok: true } | { ok: false; error: string };

export type CharterPanelView = {
  isPartner: boolean;
  charter: PlanCharter;
  status: CharterStatus;
  signedAt: string | null;
  signedByName: string | null;
  /** What still stands between the charter and its sign-off. */
  blockers: string[];
  /** The proposal's own win themes, offered when the charter has none. */
  proposalThemes: { title: string; statement: string }[];
  hasProposal: boolean;
  agreement: { status: AgreementStatus; date: string | null; fileName: string; fileSize: number; hasFile: boolean };
  budget: { hours: number | null; dollars: number | null };
  cutoffs: Record<CutoffKind, { own: string | null; date: string | null; fromKeyDate: boolean }>;
  risks: PlanRisk[];
};

async function ownPlan(organizationId: string, opportunityId: string) {
  const [row] = await db
    .select()
    .from(opportunityPlans)
    .where(and(eq(opportunityPlans.organizationId, organizationId), eq(opportunityPlans.opportunityId, opportunityId)))
    .limit(1);
  return row ?? null;
}

/** The opportunity's newest proposal, whose win themes the charter reads and writes. */
async function proposalOf(organizationId: string, opportunityId: string) {
  const [row] = await db
    .select({ id: proposals.id, winThemes: proposals.winThemes })
    .from(proposals)
    .where(and(eq(proposals.organizationId, organizationId), eq(proposals.opportunityId, opportunityId)))
    .orderBy(desc(proposals.createdAt))
    .limit(1);
  return row ?? null;
}

export async function keyDatesOf(organizationId: string, solicitationId: string | null): Promise<SolicitationKeyDate[]> {
  if (!solicitationId) return [];
  const [sol] = await db
    .select({ keyDates: solicitations.keyDates })
    .from(solicitations)
    .where(and(eq(solicitations.organizationId, organizationId), eq(solicitations.id, solicitationId)))
    .limit(1);
  return ((sol?.keyDates ?? []) as SolicitationKeyDate[]).filter((k) => k.isoDate);
}

export async function loadCharterPanel(input: { organizationId: string; opportunityId: string }): Promise<CharterPanelView | null> {
  const { organizationId, opportunityId } = input;
  const plan = await ownPlan(organizationId, opportunityId);
  if (!plan) return null;
  const [decision, proposal, keyDates, signer] = await Promise.all([
    latestDecisions(organizationId, [opportunityId]).then((m) => m.get(opportunityId) ?? null),
    proposalOf(organizationId, opportunityId),
    keyDatesOf(organizationId, plan.solicitationId),
    plan.charterSignedByUserId
      ? db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, plan.charterSignedByUserId)).limit(1).then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);
  const isPartner = decision?.decision === "partner";
  const charter = normalizeCharter(plan.charter);
  const qa = resolveCutoff(plan.qaCutoffDate, keyDates, "qa");
  const amendment = resolveCutoff(plan.amendmentCutoffDate, keyDates, "amendment");
  return {
    isPartner,
    charter,
    status: charterStatus(charter, plan.charterSignedAt),
    signedAt: plan.charterSignedAt ? plan.charterSignedAt.toISOString() : null,
    signedByName: signer ? signer.name || signer.email || null : null,
    blockers: charterBlockers(charter, isPartner),
    proposalThemes: (proposal?.winThemes ?? []).slice(0, MAX_WIN_THEMES),
    hasProposal: !!proposal,
    agreement: {
      status: (plan.agreementStatus as AgreementStatus) ?? "todo",
      date: plan.agreementDate,
      fileName: plan.agreementFileName,
      fileSize: plan.agreementFileSize,
      hasFile: !!plan.agreementStorageKey,
    },
    budget: { hours: plan.budgetHours, dollars: plan.budgetDollars },
    cutoffs: { qa: { own: plan.qaCutoffDate, ...qa }, amendment: { own: plan.amendmentCutoffDate, ...amendment } },
    risks: (plan.risks ?? []) as PlanRisk[],
  };
}

function audit(organizationId: string, actor: Actor, action: string, opportunityId: string, metadata: Record<string, unknown>) {
  return recordAudit({ organizationId, actor, action, resourceType: "opportunity", resourceId: opportunityId, metadata });
}

/** Save the manager's charter. Changing the words of a signed charter withdraws the sign-off: what was signed is what stands. */
export async function saveCharter(input: { organizationId: string; opportunityId: string; charter: unknown; actor: Actor }): Promise<Result & { unsigned?: boolean }> {
  const { organizationId, opportunityId } = input;
  const plan = await ownPlan(organizationId, opportunityId);
  if (!plan) return { ok: false, error: "Open the plan first." };
  const next = normalizeCharter({ ...normalizeCharter(input.charter), sources: normalizeCharter(plan.charter).sources, draftedAt: normalizeCharter(plan.charter).draftedAt });
  const changed = !sameCharter(plan.charter, next);
  const unsign = changed && !!plan.charterSignedAt;
  await db
    .update(opportunityPlans)
    .set({ charter: next, ...(unsign ? { charterSignedAt: null, charterSignedByUserId: null } : {}), updatedAt: new Date() })
    .where(and(eq(opportunityPlans.organizationId, organizationId), eq(opportunityPlans.id, plan.id)));
  await audit(organizationId, input.actor, "opportunity.plan.charter.save", opportunityId, { planId: plan.id, changed, unsigned: unsign });
  return { ok: true, unsigned: unsign };
}

/** Store a FORGE AI draft over the charter's words (never over a signed one), keeping the proposal's win themes. */
export async function storeCharterDraft(input: { organizationId: string; opportunityId: string; draft: PlanCharter; actor: Actor; dropped: number }): Promise<Result> {
  const { organizationId, opportunityId } = input;
  const plan = await ownPlan(organizationId, opportunityId);
  if (!plan) return { ok: false, error: "Open the plan first." };
  if (plan.charterSignedAt) return { ok: false, error: "The charter is signed. Reopen it to redraft." };
  const current = normalizeCharter(plan.charter);
  const next = normalizeCharter({ ...input.draft, winThemes: current.winThemes });
  await db.update(opportunityPlans).set({ charter: next, updatedAt: new Date() }).where(and(eq(opportunityPlans.organizationId, organizationId), eq(opportunityPlans.id, plan.id)));
  await audit(organizationId, input.actor, "opportunity.plan.charter.draft", opportunityId, { planId: plan.id, sources: next.sources?.length ?? 0, dropped: input.dropped });
  return { ok: true };
}

/**
 * Sign the charter: the manager's name and the day. Its win themes are
 * written to the opportunity's proposal when it has none of its own, so
 * Develop's section drafts thread the same themes.
 */
export async function signCharter(input: { organizationId: string; opportunityId: string; actor: Actor; now?: Date }): Promise<Result & { wroteThemes?: number }> {
  const { organizationId, opportunityId } = input;
  const plan = await ownPlan(organizationId, opportunityId);
  if (!plan) return { ok: false, error: "Open the plan first." };
  if (plan.charterSignedAt) return { ok: false, error: "The charter is already signed." };
  const isPartner = (await latestDecisions(organizationId, [opportunityId])).get(opportunityId)?.decision === "partner";
  const blockers = charterBlockers(plan.charter, isPartner);
  if (blockers.length > 0) return { ok: false, error: blockers[0] };
  const charter = normalizeCharter(plan.charter);
  const signedAt = input.now ?? new Date();
  await db
    .update(opportunityPlans)
    .set({ charterSignedAt: signedAt, charterSignedByUserId: input.actor.userId, updatedAt: signedAt })
    .where(and(eq(opportunityPlans.organizationId, organizationId), eq(opportunityPlans.id, plan.id)));
  let wroteThemes = 0;
  const proposal = await proposalOf(organizationId, opportunityId);
  if (proposal && (proposal.winThemes ?? []).length === 0 && (charter.winThemes ?? []).length > 0) {
    const themes = (charter.winThemes ?? []).slice(0, MAX_WIN_THEMES);
    await db.update(proposals).set({ winThemes: themes }).where(and(eq(proposals.organizationId, organizationId), eq(proposals.id, proposal.id)));
    wroteThemes = themes.length;
  }
  await audit(organizationId, input.actor, "opportunity.plan.charter.sign", opportunityId, { planId: plan.id, wroteThemes });
  return { ok: true, wroteThemes };
}

/** Withdraw the sign-off so the charter can change; Move to Develop waits for the next one. */
export async function reopenCharter(input: { organizationId: string; opportunityId: string; actor: Actor }): Promise<Result> {
  const { organizationId, opportunityId } = input;
  const plan = await ownPlan(organizationId, opportunityId);
  if (!plan) return { ok: false, error: "Open the plan first." };
  if (!plan.charterSignedAt) return { ok: false, error: "The charter is not signed." };
  await db
    .update(opportunityPlans)
    .set({ charterSignedAt: null, charterSignedByUserId: null, updatedAt: new Date() })
    .where(and(eq(opportunityPlans.organizationId, organizationId), eq(opportunityPlans.id, plan.id)));
  await audit(organizationId, input.actor, "opportunity.plan.charter.reopen", opportunityId, { planId: plan.id });
  return { ok: true };
}

export async function setAgreement(input: { organizationId: string; opportunityId: string; status: AgreementStatus; date: string | null; actor: Actor }): Promise<Result> {
  const { organizationId, opportunityId } = input;
  const plan = await ownPlan(organizationId, opportunityId);
  if (!plan) return { ok: false, error: "Open the plan first." };
  const problem = agreementProblem(input.status, input.date);
  if (problem) return { ok: false, error: problem };
  await db
    .update(opportunityPlans)
    .set({ agreementStatus: input.status, agreementDate: input.date, updatedAt: new Date() })
    .where(and(eq(opportunityPlans.organizationId, organizationId), eq(opportunityPlans.id, plan.id)));
  await audit(organizationId, input.actor, "opportunity.plan.agreement", opportunityId, { planId: plan.id, from: plan.agreementStatus, to: input.status, date: input.date });
  return { ok: true };
}

/** Save the budget estimate and the cut-off dates (a cleared cut-off reads the solicitation's key date again). */
export async function saveBudgetAndCutoffs(input: {
  organizationId: string;
  opportunityId: string;
  hours: unknown;
  dollars: unknown;
  qaCutoff: string | null;
  amendmentCutoff: string | null;
  actor: Actor;
}): Promise<Result> {
  const { organizationId, opportunityId } = input;
  const plan = await ownPlan(organizationId, opportunityId);
  if (!plan) return { ok: false, error: "Open the plan first." };
  const hours = parseEstimate(input.hours, MAX_BUDGET_HOURS);
  const dollars = parseEstimate(input.dollars, MAX_BUDGET_DOLLARS);
  if (hours === "invalid") return { ok: false, error: "Hours must be a whole number." };
  if (dollars === "invalid") return { ok: false, error: "Dollars must be a whole number." };
  const day = /^\d{4}-\d{2}-\d{2}$/;
  for (const d of [input.qaCutoff, input.amendmentCutoff]) if (d && !day.test(d)) return { ok: false, error: "Choose a day for each cut-off." };
  await db
    .update(opportunityPlans)
    .set({ budgetHours: hours, budgetDollars: dollars, qaCutoffDate: input.qaCutoff || null, amendmentCutoffDate: input.amendmentCutoff || null, updatedAt: new Date() })
    .where(and(eq(opportunityPlans.organizationId, organizationId), eq(opportunityPlans.id, plan.id)));
  await audit(organizationId, input.actor, "opportunity.plan.budget", opportunityId, { planId: plan.id, hours, dollars, qaCutoff: input.qaCutoff, amendmentCutoff: input.amendmentCutoff });
  return { ok: true };
}

/** Replace the risk list. An owner must be a user; one that is not a member of this organization is dropped to none. */
export async function saveRisks(input: { organizationId: string; opportunityId: string; risks: unknown; memberIds: ReadonlySet<string>; actor: Actor }): Promise<Result> {
  const { organizationId, opportunityId } = input;
  const plan = await ownPlan(organizationId, opportunityId);
  if (!plan) return { ok: false, error: "Open the plan first." };
  const risks = normalizeRisks(input.risks, randomUUID).map((r) => (r.ownerUserId && !input.memberIds.has(r.ownerUserId) ? { ...r, ownerUserId: null } : r));
  await db.update(opportunityPlans).set({ risks, updatedAt: new Date() }).where(and(eq(opportunityPlans.organizationId, organizationId), eq(opportunityPlans.id, plan.id)));
  await audit(organizationId, input.actor, "opportunity.plan.risks", opportunityId, { planId: plan.id, count: risks.length });
  return { ok: true };
}

/** Record the agreement's file once the action has claimed the upload; returns the key it replaced, to release. */
export async function setAgreementFile(input: { organizationId: string; opportunityId: string; fileName: string; storageKey: string; size: number; actor: Actor }): Promise<{ ok: true; replacedKey: string } | { ok: false; error: string }> {
  const { organizationId, opportunityId } = input;
  const plan = await ownPlan(organizationId, opportunityId);
  if (!plan) return { ok: false, error: "Open the plan first." };
  await db
    .update(opportunityPlans)
    .set({ agreementFileName: input.fileName, agreementStorageKey: input.storageKey, agreementFileSize: input.size, updatedAt: new Date() })
    .where(and(eq(opportunityPlans.organizationId, organizationId), eq(opportunityPlans.id, plan.id)));
  await audit(organizationId, input.actor, "opportunity.plan.agreement.file", opportunityId, { planId: plan.id, fileName: input.fileName, size: input.size });
  return { ok: true, replacedKey: plan.agreementStorageKey };
}

export async function agreementFileOf(organizationId: string, opportunityId: string): Promise<{ storageKey: string; fileName: string } | null> {
  const plan = await ownPlan(organizationId, opportunityId);
  return plan?.agreementStorageKey ? { storageKey: plan.agreementStorageKey, fileName: plan.agreementFileName } : null;
}

export async function opportunityTitleOf(organizationId: string, opportunityId: string): Promise<{ title: string; agency: string } | null> {
  const [opp] = await db
    .select({ title: opportunities.title, agency: opportunities.agency })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  return opp ?? null;
}
