import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, memberships, notificationRules, notifications, opportunityPlanRoles, opportunityPlans, solicitationAssignments, solicitations, users } from "@/db/schema";
import { addPlanRole, listPlanMembers, loadPlan, planSummaries, removePlanRole, setPlanRaci } from "@/lib/plan-store";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

vi.mock("@/lib/email", () => ({
  emailConfigured: () => false,
  sendRuleNotificationEmail: vi.fn(async () => undefined),
}));

/**
 * BL-NAV-LIFECYCLE 4a — the plan is created on the first visit, seeded
 * from the solicitation's team and kept in step with it; naming someone
 * tells them through the seeded default rule; nothing crosses tenants.
 */
describe("BL-NAV-LIFECYCLE 4a — the plan, its team and the RACI", () => {
  let fx: TwoTenantFixture;
  let pm: string;
  let smeA: string;
  let outsider: string;
  let solicitationId: string;
  const tag = () => `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  beforeEach(async () => {
    fx = await createTwoTenants("plan");
    pm = `pm-${tag()}`;
    smeA = `sme-${tag()}`;
    outsider = `out-${tag()}`;
    await db.insert(users).values([
      { id: pm, name: "Pat Manager", email: `${pm}@bl19-isolation.test` },
      { id: smeA, name: "Sam Expert", email: `${smeA}@bl19-isolation.test` },
      { id: outsider, name: "Other Org", email: `${outsider}@bl19-isolation.test` },
    ]);
    await db.insert(memberships).values([
      { userId: pm, organizationId: fx.orgA.organizationId, role: "proposal", status: "active" },
      { userId: smeA, organizationId: fx.orgA.organizationId, role: "proposal", status: "active" },
      { userId: outsider, organizationId: fx.orgB.organizationId, role: "proposal", status: "active" },
    ]);
    const [sol] = await db
      .insert(solicitations)
      .values({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, title: "RFP" })
      .returning({ id: solicitations.id });
    solicitationId = sol.id;
    await db.insert(solicitationAssignments).values([
      { organizationId: fx.orgA.organizationId, solicitationId, userId: fx.orgA.userId, role: "capture_lead", notes: "from capture" },
      { organizationId: fx.orgA.organizationId, solicitationId, userId: pm, role: "proposal_manager" },
    ]);
  });

  afterEach(async () => {
    await fx.cleanup();
    await db.delete(users).where(eq(users.id, pm));
    await db.delete(users).where(eq(users.id, smeA));
    await db.delete(users).where(eq(users.id, outsider));
  });

  const actorA = () => ({ userId: fx.orgA.userId, email: "a@bl19-isolation.test", name: "Ana Owner" });

  it("creates the plan on the first visit, seeded from the solicitation's team, and keeps it in step", async () => {
    const plan = await loadPlan({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, actor: actorA() });
    expect(plan).not.toBeNull();
    expect(plan!.solicitationId).toBe(solicitationId);
    expect(plan!.teamSeededAt).not.toBeNull();
    expect(plan!.roles.map((r) => [r.userId, r.role, r.source, r.notes]).sort()).toEqual(
      [
        [fx.orgA.userId, "capture_lead", "seeded", "from capture"],
        [pm, "proposal_manager", "seeded", ""],
      ].sort(),
    );
    expect(plan!.state.people).toBe(2);

    // A second visit is idempotent; a new assignment flows in, a dropped one flows out.
    await db.insert(solicitationAssignments).values({ organizationId: fx.orgA.organizationId, solicitationId, userId: smeA, role: "subject_matter_expert" });
    await db.delete(solicitationAssignments).where(and(eq(solicitationAssignments.solicitationId, solicitationId), eq(solicitationAssignments.userId, pm)));
    const again = await loadPlan({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, actor: actorA() });
    expect(again!.id).toBe(plan!.id);
    expect(again!.roles.map((r) => `${r.userId}:${r.role}`).sort()).toEqual([`${fx.orgA.userId}:capture_lead`, `${smeA}:subject_matter_expert`].sort());

    const plans = await db.select({ id: opportunityPlans.id }).from(opportunityPlans).where(eq(opportunityPlans.opportunityId, fx.orgA.opportunityId));
    expect(plans).toHaveLength(1);
    const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.resourceId, fx.orgA.opportunityId)));
    expect(audits.map((a) => a.action).filter((a) => a.startsWith("opportunity.plan.")).sort()).toEqual(["opportunity.plan.create", "opportunity.plan.team.seed", "opportunity.plan.team.seed"]);
    // Seeding never notifies: the solicitation already did.
    expect(await db.select().from(notifications).where(eq(notifications.organizationId, fx.orgA.organizationId))).toEqual([]);
  });

  it("names a person, mirrors a shared role onto the solicitation, and tells them through the seeded default rule", async () => {
    const res = await addPlanRole({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, userId: smeA, role: "technical_lead", colorTeam: null, notes: "Volume II", actor: actorA() });
    expect(res.ok).toBe(true);
    const mirrored = await db.select({ role: solicitationAssignments.role, notes: solicitationAssignments.notes }).from(solicitationAssignments).where(and(eq(solicitationAssignments.solicitationId, solicitationId), eq(solicitationAssignments.userId, smeA)));
    expect(mirrored).toEqual([{ role: "technical_lead", notes: "Volume II" }]);

    const rules = await db.select({ name: notificationRules.name, channels: notificationRules.channels }).from(notificationRules).where(and(eq(notificationRules.organizationId, fx.orgA.organizationId), eq(notificationRules.triggerEventKind, "plan_role_assigned")));
    expect(rules).toEqual([{ name: "Default: Plan role assigned", channels: ["in_app", "email"] }]);
    const inbox = await db.select({ kind: notifications.kind, recipientUserId: notifications.recipientUserId, subject: notifications.subject, linkPath: notifications.linkPath }).from(notifications).where(eq(notifications.organizationId, fx.orgA.organizationId));
    expect(inbox).toEqual([{ kind: "plan_role_assigned", recipientUserId: smeA, subject: expect.stringContaining("Named Technical lead on the plan"), linkPath: `/opportunities/${fx.orgA.opportunityId}/plan` }]);

    // A plan-only role is not mirrored; naming yourself does not notify; a repeat is refused.
    expect((await addPlanRole({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, userId: fx.orgA.userId, role: "executive_sponsor", colorTeam: null, notes: "", actor: actorA() })).ok).toBe(true);
    expect(await db.select().from(solicitationAssignments).where(and(eq(solicitationAssignments.solicitationId, solicitationId), eq(solicitationAssignments.userId, fx.orgA.userId), eq(solicitationAssignments.role, "capture_lead")))).toHaveLength(1);
    expect(await db.select().from(notifications).where(eq(notifications.organizationId, fx.orgA.organizationId))).toHaveLength(1);
    expect(await addPlanRole({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, userId: smeA, role: "technical_lead", colorTeam: null, notes: "", actor: actorA() })).toEqual({ ok: false, error: "They already hold that role on the plan." });
  });

  it("names colour teams per colour and removes the shared assignment only with the last colour row", async () => {
    const org = fx.orgA.organizationId;
    const opp = fx.orgA.opportunityId;
    const red = await addPlanRole({ organizationId: org, opportunityId: opp, userId: smeA, role: "color_team_reviewer", colorTeam: "red", notes: "", actor: actorA() });
    const gold = await addPlanRole({ organizationId: org, opportunityId: opp, userId: smeA, role: "color_team_reviewer", colorTeam: "gold", notes: "", actor: actorA() });
    expect(red.ok && gold.ok).toBe(true);
    const plan = await loadPlan({ organizationId: org, opportunityId: opp, actor: actorA() });
    expect(plan!.state.colorTeams).toEqual({ pink: 0, red: 1, gold: 1, white_gloves: 0 });
    expect(await db.select().from(solicitationAssignments).where(and(eq(solicitationAssignments.solicitationId, solicitationId), eq(solicitationAssignments.userId, smeA)))).toHaveLength(1);

    expect((await removePlanRole({ organizationId: org, opportunityId: opp, roleId: (red as { ok: true; id: string }).id, actor: actorA() })).ok).toBe(true);
    expect(await db.select().from(solicitationAssignments).where(and(eq(solicitationAssignments.solicitationId, solicitationId), eq(solicitationAssignments.userId, smeA)))).toHaveLength(1);
    expect((await removePlanRole({ organizationId: org, opportunityId: opp, roleId: (gold as { ok: true; id: string }).id, actor: actorA() })).ok).toBe(true);
    expect(await db.select().from(solicitationAssignments).where(and(eq(solicitationAssignments.solicitationId, solicitationId), eq(solicitationAssignments.userId, smeA)))).toHaveLength(0);
    // The next visit does not resurrect the removed reviewer.
    const after = await loadPlan({ organizationId: org, opportunityId: opp, actor: actorA() });
    expect(after!.roles.some((r) => r.userId === smeA)).toBe(false);
  });

  it("sets RACI letters and reports the state per opportunity", async () => {
    const org = fx.orgA.organizationId;
    const opp = fx.orgA.opportunityId;
    const plan = await loadPlan({ organizationId: org, opportunityId: opp, actor: actorA() });
    const pmRow = plan!.roles.find((r) => r.userId === pm)!;
    expect((await setPlanRaci({ organizationId: org, opportunityId: opp, roleId: pmRow.id, area: "management", letter: "A", actor: actorA() })).ok).toBe(true);
    expect((await setPlanRaci({ organizationId: org, opportunityId: opp, roleId: pmRow.id, area: "technical", letter: "C", actor: actorA() })).ok).toBe(true);
    expect((await setPlanRaci({ organizationId: org, opportunityId: opp, roleId: pmRow.id, area: "technical", letter: null, actor: actorA() })).ok).toBe(true);
    const [row] = await db.select({ raci: opportunityPlanRoles.raci }).from(opportunityPlanRoles).where(eq(opportunityPlanRoles.id, pmRow.id));
    expect(row.raci).toEqual({ management: "A" });
    const summaries = await planSummaries(org, [opp, fx.orgB.opportunityId]);
    expect(summaries.get(opp)!.accountable).toEqual(["management"]);
    expect(summaries.get(fx.orgB.opportunityId)!.people).toBe(0);
  });

  it("keeps everything inside the tenant", async () => {
    const a = fx.orgA;
    const b = fx.orgB;
    await loadPlan({ organizationId: a.organizationId, opportunityId: a.opportunityId, actor: actorA() });
    const planA = await db.select({ id: opportunityPlans.id }).from(opportunityPlans).where(eq(opportunityPlans.opportunityId, a.opportunityId));
    const roleA = await db.select({ id: opportunityPlanRoles.id }).from(opportunityPlanRoles).where(eq(opportunityPlanRoles.planId, planA[0].id));
    const actorB = { userId: b.userId, email: "b@bl19-isolation.test", name: "Bo" };

    expect(await loadPlan({ organizationId: b.organizationId, opportunityId: a.opportunityId, actor: actorB })).toBeNull();
    expect((await addPlanRole({ organizationId: b.organizationId, opportunityId: a.opportunityId, userId: outsider, role: "contracts", colorTeam: null, notes: "", actor: actorB })).ok).toBe(false);
    expect((await addPlanRole({ organizationId: a.organizationId, opportunityId: a.opportunityId, userId: outsider, role: "contracts", colorTeam: null, notes: "", actor: actorA() })).ok).toBe(false);
    expect((await removePlanRole({ organizationId: b.organizationId, opportunityId: a.opportunityId, roleId: roleA[0].id, actor: actorB })).ok).toBe(false);
    expect((await setPlanRaci({ organizationId: b.organizationId, opportunityId: a.opportunityId, roleId: roleA[0].id, area: "pricing", letter: "A", actor: actorB })).ok).toBe(false);
    expect((await planSummaries(b.organizationId, [a.opportunityId])).get(a.opportunityId)!.people).toBe(0);
    const membersB = (await listPlanMembers(b.organizationId)).map((m) => m.id);
    expect(membersB).toContain(outsider);
    expect(membersB).not.toContain(pm);

    expect(await db.select().from(opportunityPlanRoles).where(eq(opportunityPlanRoles.planId, planA[0].id))).toHaveLength(2);
    expect(await db.select().from(opportunityPlans).where(eq(opportunityPlans.organizationId, b.organizationId))).toHaveLength(0);
  });
});
