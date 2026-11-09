import "server-only";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  memberships,
  notificationRules,
  opportunities,
  opportunityPlanRoles,
  opportunityPlans,
  solicitationAssignments,
  solicitations,
  users,
  type PlanRaci,
  type PlanRole,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { dispatchTriggerEvent } from "@/lib/notification-dispatcher";
import {
  diffTeam,
  isSharedRole,
  normalizeRaci,
  planRoleAssignedMessage,
  planState,
  withRaciLetter,
  type PlanColorTeam,
  type PlanState,
  type RaciArea,
  type RaciLetter,
} from "@/lib/plan-logic";

/**
 * BL-NAV-LIFECYCLE 4a — the Plan's store: one plan per opportunity, its
 * team (seeded from the solicitation's assignments and kept in step with
 * them), the RACI letters and the colour teams. Callers own the auth
 * gate; every function scopes by organizationId.
 */

type Actor = { userId: string; email?: string | null; name?: string | null };
type Result = { ok: true; id?: string } | { ok: false; error: string };

export type PlanRoleView = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  role: PlanRole;
  colorTeam: string | null;
  raci: PlanRaci;
  notes: string;
  source: string;
};

export type PlanView = {
  id: string;
  opportunityId: string;
  solicitationId: string | null;
  teamSeededAt: Date | null;
  roles: PlanRoleView[];
  state: PlanState;
};

export type PlanMember = { id: string; name: string; email: string };

async function ownOpportunity(organizationId: string, opportunityId: string) {
  const [opp] = await db
    .select({ id: opportunities.id, title: opportunities.title })
    .from(opportunities)
    .where(and(eq(opportunities.id, opportunityId), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  return opp ?? null;
}

/** The opportunity's original solicitation (not an amendment), newest first. */
async function solicitationOf(organizationId: string, opportunityId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: solicitations.id })
    .from(solicitations)
    .where(and(eq(solicitations.organizationId, organizationId), eq(solicitations.opportunityId, opportunityId), isNull(solicitations.parentSolicitationId)))
    .orderBy(desc(solicitations.createdAt))
    .limit(1);
  return row?.id ?? null;
}

async function planRows(organizationId: string, planId: string): Promise<PlanRoleView[]> {
  const rows = await db
    .select({
      id: opportunityPlanRoles.id,
      userId: opportunityPlanRoles.userId,
      userName: users.name,
      userEmail: users.email,
      role: opportunityPlanRoles.role,
      colorTeam: opportunityPlanRoles.colorTeam,
      raci: opportunityPlanRoles.raci,
      notes: opportunityPlanRoles.notes,
      source: opportunityPlanRoles.source,
    })
    .from(opportunityPlanRoles)
    .innerJoin(users, eq(users.id, opportunityPlanRoles.userId))
    .where(and(eq(opportunityPlanRoles.organizationId, organizationId), eq(opportunityPlanRoles.planId, planId)))
    .orderBy(asc(opportunityPlanRoles.assignedAt));
  return rows.map((r) => ({ ...r, userName: r.userName ?? "", userEmail: r.userEmail ?? "", raci: normalizeRaci(r.raci) }));
}

/**
 * The opportunity's plan, created on the first visit. Each load brings the
 * team in step with the solicitation's assignments: new assignments are
 * added (seeded, audited once), assignments that are gone are removed.
 * Seeding does not notify: the solicitation already did.
 */
export async function loadPlan(input: { organizationId: string; opportunityId: string; actor: Actor }): Promise<PlanView | null> {
  const { organizationId, opportunityId } = input;
  const opp = await ownOpportunity(organizationId, opportunityId);
  if (!opp) return null;

  let [plan] = await db
    .select({ id: opportunityPlans.id, solicitationId: opportunityPlans.solicitationId, teamSeededAt: opportunityPlans.teamSeededAt })
    .from(opportunityPlans)
    .where(and(eq(opportunityPlans.organizationId, organizationId), eq(opportunityPlans.opportunityId, opportunityId)))
    .limit(1);
  if (!plan) {
    const solicitationId = await solicitationOf(organizationId, opportunityId);
    const [created] = await db
      .insert(opportunityPlans)
      .values({ organizationId, opportunityId, solicitationId, createdByUserId: input.actor.userId })
      .onConflictDoNothing({ target: opportunityPlans.opportunityId })
      .returning({ id: opportunityPlans.id, solicitationId: opportunityPlans.solicitationId, teamSeededAt: opportunityPlans.teamSeededAt });
    if (created) {
      plan = created;
      await recordAudit({ organizationId, actor: input.actor, action: "opportunity.plan.create", resourceType: "opportunity", resourceId: opportunityId, metadata: { planId: plan.id, solicitationId } });
    } else {
      [plan] = await db
        .select({ id: opportunityPlans.id, solicitationId: opportunityPlans.solicitationId, teamSeededAt: opportunityPlans.teamSeededAt })
        .from(opportunityPlans)
        .where(and(eq(opportunityPlans.organizationId, organizationId), eq(opportunityPlans.opportunityId, opportunityId)))
        .limit(1);
    }
  }

  let rows = await planRows(organizationId, plan.id);
  let teamSeededAt = plan.teamSeededAt;
  if (plan.solicitationId) {
    const assignments = await db
      .select({ userId: solicitationAssignments.userId, role: solicitationAssignments.role, notes: solicitationAssignments.notes })
      .from(solicitationAssignments)
      .where(and(eq(solicitationAssignments.organizationId, organizationId), eq(solicitationAssignments.solicitationId, plan.solicitationId)));
    const diff = diffTeam(rows, assignments.map((a) => ({ ...a, notes: a.notes ?? "" })));
    if (diff.toAdd.length > 0 || diff.toRemoveIds.length > 0) {
      if (diff.toRemoveIds.length > 0) {
        await db.delete(opportunityPlanRoles).where(and(eq(opportunityPlanRoles.organizationId, organizationId), inArray(opportunityPlanRoles.id, diff.toRemoveIds)));
      }
      if (diff.toAdd.length > 0) {
        await db
          .insert(opportunityPlanRoles)
          .values(diff.toAdd.map((a) => ({ organizationId, planId: plan.id, opportunityId, userId: a.userId, role: a.role, notes: a.notes, source: "seeded", assignedByUserId: null })))
          .onConflictDoNothing();
      }
      teamSeededAt = teamSeededAt ?? new Date();
      await db.update(opportunityPlans).set({ teamSeededAt, updatedAt: new Date() }).where(and(eq(opportunityPlans.organizationId, organizationId), eq(opportunityPlans.id, plan.id)));
      await recordAudit({
        organizationId,
        actor: input.actor,
        action: "opportunity.plan.team.seed",
        resourceType: "opportunity",
        resourceId: opportunityId,
        metadata: { planId: plan.id, solicitationId: plan.solicitationId, added: diff.toAdd.length, removed: diff.toRemoveIds.length },
      });
      rows = await planRows(organizationId, plan.id);
    }
  }
  return { id: plan.id, opportunityId, solicitationId: plan.solicitationId, teamSeededAt, roles: rows, state: planState(rows) };
}

/** Active members of the organization, for the person picker. */
export async function listPlanMembers(organizationId: string): Promise<PlanMember[]> {
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.status, "active")))
    .orderBy(asc(users.name), asc(users.email));
  return rows.map((r) => ({ id: r.id, name: r.name ?? "", email: r.email ?? "" }));
}

/** A tenant created after migration 0160 gets the default rule the first time a plan names someone. */
async function ensureDefaultRule(organizationId: string): Promise<void> {
  const [any] = await db
    .select({ id: notificationRules.id })
    .from(notificationRules)
    .where(and(eq(notificationRules.organizationId, organizationId), eq(notificationRules.triggerEventKind, "plan_role_assigned")))
    .limit(1);
  if (any) return;
  await db.insert(notificationRules).values({
    organizationId,
    name: "Default: Plan role assigned",
    description: "When someone is named to a role, or a colour team, on an opportunity's plan, they are told at once, in the inbox and by email.",
    triggerEventKind: "plan_role_assigned",
    recipientStrategy: "mentioned_in_payload",
    channels: ["in_app", "email"],
    frequency: "immediate",
  });
}

/** Names a person to a role (or a colour team) on the plan; mirrors a shared role onto the solicitation; tells them. */
export async function addPlanRole(input: {
  organizationId: string;
  opportunityId: string;
  userId: string;
  role: PlanRole;
  colorTeam: PlanColorTeam | null;
  notes: string;
  actor: Actor;
}): Promise<Result> {
  const { organizationId, opportunityId } = input;
  const opp = await ownOpportunity(organizationId, opportunityId);
  if (!opp) return { ok: false, error: "Opportunity not found." };
  const [member] = await listPlanMembers(organizationId).then((m) => m.filter((x) => x.id === input.userId));
  if (!member) return { ok: false, error: "That person is not an active member of this company." };
  const plan = await loadPlan({ organizationId, opportunityId, actor: input.actor });
  if (!plan) return { ok: false, error: "Opportunity not found." };
  const colorTeam = input.role === "color_team_reviewer" ? input.colorTeam : null;
  if (plan.roles.some((r) => r.userId === input.userId && r.role === input.role && (r.colorTeam ?? null) === colorTeam)) {
    return { ok: false, error: "They already hold that role on the plan." };
  }
  const [row] = await db
    .insert(opportunityPlanRoles)
    .values({ organizationId, planId: plan.id, opportunityId, userId: input.userId, role: input.role, colorTeam, notes: input.notes, source: "manual", assignedByUserId: input.actor.userId })
    .returning({ id: opportunityPlanRoles.id });
  if (plan.solicitationId && isSharedRole(input.role)) {
    await db
      .insert(solicitationAssignments)
      .values({ organizationId, solicitationId: plan.solicitationId, userId: input.userId, role: input.role, notes: input.notes, assignedByUserId: input.actor.userId })
      .onConflictDoNothing();
  }
  await db.update(opportunityPlans).set({ updatedAt: new Date() }).where(and(eq(opportunityPlans.organizationId, organizationId), eq(opportunityPlans.id, plan.id)));
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "opportunity.plan.role.add",
    resourceType: "opportunity_plan_role",
    resourceId: row.id,
    metadata: { opportunityId, planId: plan.id, userId: input.userId, role: input.role, colorTeam },
  });
  if (input.userId !== input.actor.userId) {
    await ensureDefaultRule(organizationId);
    const msg = planRoleAssignedMessage({
      actorName: input.actor.name ?? input.actor.email ?? "A teammate",
      role: input.role,
      colorTeam,
      opportunityTitle: opp.title ?? "",
      notes: input.notes,
    });
    await dispatchTriggerEvent({
      organizationId,
      kind: "plan_role_assigned",
      payload: { opportunityId, planId: plan.id, planRoleId: row.id, assigneeUserId: input.userId, role: input.role, colorTeam, mentionedUserIds: [input.userId] },
      subject: msg.subject,
      body: msg.body,
      linkPath: `/opportunities/${opportunityId}/plan`,
      actorUserId: input.actor.userId,
    });
  }
  return { ok: true, id: row.id };
}

/** Removes a plan role; a shared role leaves the solicitation too once the person holds no other row of that role. */
export async function removePlanRole(input: { organizationId: string; opportunityId: string; roleId: string; actor: Actor }): Promise<Result> {
  const { organizationId, opportunityId } = input;
  const [row] = await db
    .select({ id: opportunityPlanRoles.id, planId: opportunityPlanRoles.planId, userId: opportunityPlanRoles.userId, role: opportunityPlanRoles.role, colorTeam: opportunityPlanRoles.colorTeam })
    .from(opportunityPlanRoles)
    .where(and(eq(opportunityPlanRoles.organizationId, organizationId), eq(opportunityPlanRoles.opportunityId, opportunityId), eq(opportunityPlanRoles.id, input.roleId)))
    .limit(1);
  if (!row) return { ok: false, error: "That role is no longer on the plan." };
  await db.delete(opportunityPlanRoles).where(and(eq(opportunityPlanRoles.organizationId, organizationId), eq(opportunityPlanRoles.id, row.id)));
  if (isSharedRole(row.role)) {
    const [plan] = await db.select({ solicitationId: opportunityPlans.solicitationId }).from(opportunityPlans).where(and(eq(opportunityPlans.organizationId, organizationId), eq(opportunityPlans.id, row.planId))).limit(1);
    const [still] = await db
      .select({ id: opportunityPlanRoles.id })
      .from(opportunityPlanRoles)
      .where(and(eq(opportunityPlanRoles.organizationId, organizationId), eq(opportunityPlanRoles.planId, row.planId), eq(opportunityPlanRoles.userId, row.userId), eq(opportunityPlanRoles.role, row.role)))
      .limit(1);
    if (plan?.solicitationId && !still) {
      await db
        .delete(solicitationAssignments)
        .where(and(eq(solicitationAssignments.organizationId, organizationId), eq(solicitationAssignments.solicitationId, plan.solicitationId), eq(solicitationAssignments.userId, row.userId), eq(solicitationAssignments.role, row.role)));
    }
  }
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "opportunity.plan.role.remove",
    resourceType: "opportunity_plan_role",
    resourceId: row.id,
    metadata: { opportunityId, planId: row.planId, userId: row.userId, role: row.role, colorTeam: row.colorTeam },
  });
  return { ok: true };
}

/** Sets or clears one RACI letter for one person in one area. */
export async function setPlanRaci(input: { organizationId: string; opportunityId: string; roleId: string; area: RaciArea; letter: RaciLetter | null; actor: Actor }): Promise<Result> {
  const { organizationId, opportunityId } = input;
  const [row] = await db
    .select({ id: opportunityPlanRoles.id, raci: opportunityPlanRoles.raci })
    .from(opportunityPlanRoles)
    .where(and(eq(opportunityPlanRoles.organizationId, organizationId), eq(opportunityPlanRoles.opportunityId, opportunityId), eq(opportunityPlanRoles.id, input.roleId)))
    .limit(1);
  if (!row) return { ok: false, error: "That role is no longer on the plan." };
  const raci = withRaciLetter(row.raci, input.area, input.letter);
  await db.update(opportunityPlanRoles).set({ raci }).where(and(eq(opportunityPlanRoles.organizationId, organizationId), eq(opportunityPlanRoles.id, row.id)));
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "opportunity.plan.raci.set",
    resourceType: "opportunity_plan_role",
    resourceId: row.id,
    metadata: { opportunityId, area: input.area, letter: input.letter },
  });
  return { ok: true };
}

/** The plan's state per opportunity, for the Pipeline → Plan rows; an opportunity with no plan yet reads as empty. */
export async function planSummaries(organizationId: string, opportunityIds: string[]): Promise<Map<string, PlanState>> {
  const out = new Map<string, PlanState>();
  if (opportunityIds.length === 0) return out;
  const rows = await db
    .select({ id: opportunityPlanRoles.id, opportunityId: opportunityPlanRoles.opportunityId, userId: opportunityPlanRoles.userId, role: opportunityPlanRoles.role, colorTeam: opportunityPlanRoles.colorTeam, raci: opportunityPlanRoles.raci })
    .from(opportunityPlanRoles)
    .where(and(eq(opportunityPlanRoles.organizationId, organizationId), inArray(opportunityPlanRoles.opportunityId, opportunityIds)));
  for (const id of opportunityIds) out.set(id, planState(rows.filter((r) => r.opportunityId === id)));
  return out;
}
