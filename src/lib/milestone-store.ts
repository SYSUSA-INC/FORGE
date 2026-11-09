import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  notificationRules,
  opportunities,
  opportunityMilestones,
  opportunityPlans,
  solicitations,
  users,
  type MilestoneKind,
  type MilestoneStatus,
  type SolicitationKeyDate,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { COLOR_TEAM_KINDS, isoDay, proposeSchedule, scheduleAnchor, scheduleState, type ScheduleState } from "@/lib/milestone-logic";
import { listPlanMembers, loadPlan } from "@/lib/plan-store";

/**
 * BL-NAV-LIFECYCLE 4b-1 — the schedule's store: the milestones on an
 * opportunity's plan, Build the schedule (the count-back proposed and
 * written), add / move / mark / remove, each audited. Callers own the
 * auth gate; every function scopes by organizationId.
 */

type Actor = { userId: string; email?: string | null; name?: string | null };
type Result = { ok: true; id?: string; added?: number } | { ok: false; error: string };

export type MilestoneView = {
  id: string;
  title: string;
  kind: MilestoneKind;
  date: string;
  ownerUserId: string | null;
  ownerName: string;
  status: MilestoneStatus;
  anchorKey: string | null;
  notes: string;
};

export type ScheduleView = {
  todayIso: string;
  /** The day the count-back hangs on, and which date it is. */
  anchor: { iso: string; key: string } | null;
  keyDates: SolicitationKeyDate[];
  milestones: MilestoneView[];
  state: ScheduleState;
};

export type MilestonePatch = Partial<{ title: string; date: string; ownerUserId: string | null; status: MilestoneStatus; notes: string }>;

async function scheduleContext(organizationId: string, opportunityId: string) {
  const [opp] = await db
    .select({ id: opportunities.id, title: opportunities.title, responseDueDate: opportunities.responseDueDate })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  if (!opp) return null;
  const [plan] = await db
    .select({ id: opportunityPlans.id, solicitationId: opportunityPlans.solicitationId })
    .from(opportunityPlans)
    .where(and(eq(opportunityPlans.organizationId, organizationId), eq(opportunityPlans.opportunityId, opportunityId)))
    .limit(1);
  let keyDates: SolicitationKeyDate[] = [];
  if (plan?.solicitationId) {
    const [sol] = await db
      .select({ keyDates: solicitations.keyDates })
      .from(solicitations)
      .where(and(eq(solicitations.organizationId, organizationId), eq(solicitations.id, plan.solicitationId)))
      .limit(1);
    keyDates = ((sol?.keyDates ?? []) as SolicitationKeyDate[]).filter((k) => k.isoDate);
  }
  return { opp, plan: plan ?? null, keyDates, responseDueIso: opp.responseDueDate ? isoDay(opp.responseDueDate) : null };
}

async function milestoneRows(organizationId: string, opportunityId: string): Promise<MilestoneView[]> {
  const rows = await db
    .select({
      id: opportunityMilestones.id,
      title: opportunityMilestones.title,
      kind: opportunityMilestones.kind,
      date: opportunityMilestones.date,
      ownerUserId: opportunityMilestones.ownerUserId,
      ownerName: users.name,
      ownerEmail: users.email,
      status: opportunityMilestones.status,
      anchorKey: opportunityMilestones.anchorKey,
      notes: opportunityMilestones.notes,
    })
    .from(opportunityMilestones)
    .leftJoin(users, eq(users.id, opportunityMilestones.ownerUserId))
    .where(and(eq(opportunityMilestones.organizationId, organizationId), eq(opportunityMilestones.opportunityId, opportunityId)))
    .orderBy(asc(opportunityMilestones.date), asc(opportunityMilestones.createdAt));
  return rows.map(({ ownerEmail, ...r }) => ({ ...r, ownerName: r.ownerName ?? ownerEmail ?? "" }));
}

/** The schedule as the Plan tab shows it; null when the opportunity is not the tenant's. */
export async function loadSchedule(input: { organizationId: string; opportunityId: string }): Promise<ScheduleView | null> {
  const ctx = await scheduleContext(input.organizationId, input.opportunityId);
  if (!ctx) return null;
  const todayIso = isoDay(new Date());
  const milestones = await milestoneRows(input.organizationId, input.opportunityId);
  return { todayIso, anchor: scheduleAnchor({ responseDueIso: ctx.responseDueIso, keyDates: ctx.keyDates }), keyDates: ctx.keyDates, milestones, state: scheduleState(milestones, todayIso) };
}

/** A tenant created after migration 0162 gets the default rule the first time a milestone of its comes due. */
export async function ensureMilestoneDefaultRule(organizationId: string): Promise<void> {
  const [any] = await db
    .select({ id: notificationRules.id })
    .from(notificationRules)
    .where(and(eq(notificationRules.organizationId, organizationId), eq(notificationRules.triggerEventKind, "milestone_due_soon")))
    .limit(1);
  if (any) return;
  await db.insert(notificationRules).values({
    organizationId,
    name: "Default: Milestone due soon",
    description: "Seven, three and one days before a planned milestone on an opportunity's plan, its owner is reminded in the inbox and by email.",
    triggerEventKind: "milestone_due_soon",
    recipientStrategy: "mentioned_in_payload",
    channels: ["in_app", "email"],
    frequency: "immediate",
  });
}

async function touchPlan(organizationId: string, planId: string) {
  await db.update(opportunityPlans).set({ updatedAt: new Date() }).where(and(eq(opportunityPlans.organizationId, organizationId), eq(opportunityPlans.id, planId)));
}

/**
 * Build the schedule: the count-back proposed from the due date and
 * written, kinds already on the plan left alone. A colour-team milestone
 * gets no owner (its reviewers are the plan's colour team); the others
 * are left for the manager to assign.
 */
export async function buildSchedule(input: { organizationId: string; opportunityId: string; actor: Actor }): Promise<Result> {
  const { organizationId, opportunityId } = input;
  const plan = await loadPlan({ organizationId, opportunityId, actor: input.actor });
  if (!plan) return { ok: false, error: "Opportunity not found." };
  const ctx = await scheduleContext(organizationId, opportunityId);
  if (!ctx) return { ok: false, error: "Opportunity not found." };
  const existing = await milestoneRows(organizationId, opportunityId);
  const todayIso = isoDay(new Date());
  const proposed = proposeSchedule({ todayIso, responseDueIso: ctx.responseDueIso, keyDates: ctx.keyDates, existingKinds: existing.map((m) => m.kind) });
  if (proposed.length === 0) {
    return { ok: false, error: ctx.responseDueIso || ctx.keyDates.some((k) => k.type === "proposal_due") ? "The schedule already has every proposed milestone." : "Set the response due date first: the schedule counts back from it." };
  }
  const rows = await db
    .insert(opportunityMilestones)
    .values(
      proposed.map((p) => ({
        organizationId,
        opportunityId,
        planId: plan.id,
        title: p.title,
        kind: p.kind,
        date: p.date,
        ownerUserId: null,
        anchorKey: p.anchorKey,
        notes: p.clamped ? "Proposed before today; moved to today." : "",
        createdByUserId: input.actor.userId,
      })),
    )
    .returning({ id: opportunityMilestones.id });
  await touchPlan(organizationId, plan.id);
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "opportunity.milestone.build",
    resourceType: "opportunity",
    resourceId: opportunityId,
    metadata: { planId: plan.id, anchor: ctx.responseDueIso ? "response_due" : "proposal_due", added: rows.length, kinds: proposed.map((p) => p.kind), dates: proposed.map((p) => p.date) },
  });
  return { ok: true, added: rows.length };
}

/** Adds one milestone by hand. */
export async function addMilestone(input: { organizationId: string; opportunityId: string; title: string; kind: MilestoneKind; date: string; ownerUserId: string | null; notes: string; actor: Actor }): Promise<Result> {
  const { organizationId, opportunityId } = input;
  const plan = await loadPlan({ organizationId, opportunityId, actor: input.actor });
  if (!plan) return { ok: false, error: "Opportunity not found." };
  if (input.ownerUserId) {
    const members = await listPlanMembers(organizationId);
    if (!members.some((m) => m.id === input.ownerUserId)) return { ok: false, error: "That person is not an active member of this company." };
  }
  const [row] = await db
    .insert(opportunityMilestones)
    .values({ organizationId, opportunityId, planId: plan.id, title: input.title, kind: input.kind, date: input.date, ownerUserId: input.ownerUserId, notes: input.notes, createdByUserId: input.actor.userId })
    .returning({ id: opportunityMilestones.id });
  await touchPlan(organizationId, plan.id);
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "opportunity.milestone.add",
    resourceType: "opportunity_milestone",
    resourceId: row.id,
    metadata: { opportunityId, planId: plan.id, title: input.title, kind: input.kind, date: input.date, ownerUserId: input.ownerUserId },
  });
  return { ok: true, id: row.id };
}

/** Moves, renames, re-owns or marks one milestone; only the fields given change. */
export async function updateMilestone(input: { organizationId: string; opportunityId: string; milestoneId: string; patch: MilestonePatch; actor: Actor }): Promise<Result> {
  const { organizationId, opportunityId } = input;
  const [row] = await db
    .select({ id: opportunityMilestones.id, planId: opportunityMilestones.planId, kind: opportunityMilestones.kind, title: opportunityMilestones.title, date: opportunityMilestones.date, ownerUserId: opportunityMilestones.ownerUserId, status: opportunityMilestones.status })
    .from(opportunityMilestones)
    .where(and(eq(opportunityMilestones.organizationId, organizationId), eq(opportunityMilestones.opportunityId, opportunityId), eq(opportunityMilestones.id, input.milestoneId)))
    .limit(1);
  if (!row) return { ok: false, error: "That milestone is no longer on the plan." };
  if (input.patch.ownerUserId) {
    const members = await listPlanMembers(organizationId);
    if (!members.some((m) => m.id === input.patch.ownerUserId)) return { ok: false, error: "That person is not an active member of this company." };
  }
  const changes = Object.fromEntries(Object.entries(input.patch).filter(([, v]) => v !== undefined));
  if (Object.keys(changes).length === 0) return { ok: true, id: row.id };
  await db
    .update(opportunityMilestones)
    .set({ ...changes, updatedAt: new Date() })
    .where(and(eq(opportunityMilestones.organizationId, organizationId), eq(opportunityMilestones.id, row.id)));
  await touchPlan(organizationId, row.planId);
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "opportunity.milestone.update",
    resourceType: "opportunity_milestone",
    resourceId: row.id,
    metadata: { opportunityId, planId: row.planId, kind: row.kind, before: { title: row.title, date: row.date, ownerUserId: row.ownerUserId, status: row.status }, changes },
  });
  return { ok: true, id: row.id };
}

export async function removeMilestone(input: { organizationId: string; opportunityId: string; milestoneId: string; actor: Actor }): Promise<Result> {
  const { organizationId, opportunityId } = input;
  const [row] = await db
    .select({ id: opportunityMilestones.id, planId: opportunityMilestones.planId, kind: opportunityMilestones.kind, title: opportunityMilestones.title, date: opportunityMilestones.date })
    .from(opportunityMilestones)
    .where(and(eq(opportunityMilestones.organizationId, organizationId), eq(opportunityMilestones.opportunityId, opportunityId), eq(opportunityMilestones.id, input.milestoneId)))
    .limit(1);
  if (!row) return { ok: false, error: "That milestone is no longer on the plan." };
  await db.delete(opportunityMilestones).where(and(eq(opportunityMilestones.organizationId, organizationId), eq(opportunityMilestones.id, row.id)));
  await touchPlan(organizationId, row.planId);
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "opportunity.milestone.remove",
    resourceType: "opportunity_milestone",
    resourceId: row.id,
    metadata: { opportunityId, planId: row.planId, kind: row.kind, title: row.title, date: row.date },
  });
  return { ok: true };
}

/** Whether a kind is a colour team's round: its owner defaults to nobody. */
export function isColorTeamKind(kind: MilestoneKind): boolean {
  return COLOR_TEAM_KINDS.includes(kind);
}
