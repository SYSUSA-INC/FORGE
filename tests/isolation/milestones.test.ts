import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, memberships, notificationDeliveries, notificationRules, notifications, opportunities, opportunityMilestones, solicitations, users } from "@/db/schema";
import { dispatchMilestoneDueSoon } from "@/lib/milestone-due-soon-cron";
import { addDays, isoDay } from "@/lib/milestone-logic";
import { addMilestone, buildSchedule, loadSchedule, removeMilestone, updateMilestone } from "@/lib/milestone-store";
import { loadPlan, planSummaries } from "@/lib/plan-store";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

vi.mock("@/lib/email", () => ({
  emailConfigured: () => false,
  sendRuleNotificationEmail: vi.fn(async () => undefined),
}));

/**
 * BL-NAV-LIFECYCLE 4b-1 — Build the schedule counts back from the due
 * date and writes the milestones; the manager moves, owns, marks and
 * removes them, each audited; the daily cron reminds the owner through
 * the seeded default rule; nothing crosses tenants.
 */
describe("BL-NAV-LIFECYCLE 4b-1 — milestones and the schedule", () => {
  let fx: TwoTenantFixture;
  let pm: string;
  let outsider: string;
  const today = isoDay(new Date());
  const tag = () => `ms-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  beforeEach(async () => {
    fx = await createTwoTenants("milestones");
    pm = `pm-${tag()}`;
    outsider = `out-${tag()}`;
    await db.insert(users).values([
      { id: pm, name: "Pat Manager", email: `${pm}@bl19-isolation.test` },
      { id: outsider, name: "Other Org", email: `${outsider}@bl19-isolation.test` },
    ]);
    await db.insert(memberships).values([
      { userId: pm, organizationId: fx.orgA.organizationId, role: "proposal", status: "active" },
      { userId: outsider, organizationId: fx.orgB.organizationId, role: "proposal", status: "active" },
    ]);
    // Due in 40 days, so every proposed round lands after today.
    await db.update(opportunities).set({ responseDueDate: new Date(`${addDays(today, 40)}T12:00:00Z`) }).where(eq(opportunities.id, fx.orgA.opportunityId));
  });

  afterEach(async () => {
    await fx.cleanup();
    await db.delete(users).where(eq(users.id, pm));
    await db.delete(users).where(eq(users.id, outsider));
  });

  const actorA = () => ({ userId: fx.orgA.userId, email: "a@bl19-isolation.test", name: "Ana Owner" });
  const org = () => fx.orgA.organizationId;
  const opp = () => fx.orgA.opportunityId;

  it("builds the schedule from the due date, once, and counts it in the plan's state", async () => {
    const before = await loadSchedule({ organizationId: org(), opportunityId: opp() });
    expect(before!.anchor).toEqual({ iso: addDays(today, 40), key: "response_due" });
    expect(before!.milestones).toEqual([]);

    const res = await buildSchedule({ organizationId: org(), opportunityId: opp(), actor: actorA() });
    expect(res).toEqual({ ok: true, added: 6 });
    const after = await loadSchedule({ organizationId: org(), opportunityId: opp() });
    expect(after!.milestones.map((m) => [m.kind, m.date, m.ownerUserId, m.status])).toEqual([
      ["kick_off", today, null, "planned"],
      ["pink_team", addDays(today, 10), null, "planned"],
      ["red_team", addDays(today, 20), null, "planned"],
      ["gold_team", addDays(today, 30), null, "planned"],
      ["white_gloves", addDays(today, 36), null, "planned"],
      ["submit", addDays(today, 38), null, "planned"],
    ]);
    expect(after!.state).toEqual({ total: 6, planned: 6, done: 0, missed: 0, overdue: 0, nextDate: today });

    // Building again adds nothing and says so.
    expect(await buildSchedule({ organizationId: org(), opportunityId: opp(), actor: actorA() })).toEqual({ ok: false, error: "The schedule already has every proposed milestone." });
    expect(await db.select().from(opportunityMilestones).where(eq(opportunityMilestones.opportunityId, opp()))).toHaveLength(6);

    const plan = await loadPlan({ organizationId: org(), opportunityId: opp(), actor: actorA() });
    expect(plan!.state.milestones).toBe(6);
    expect((await planSummaries(org(), [opp()])).get(opp())!.milestones).toBe(6);
    const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(and(eq(auditLogs.organizationId, org()), eq(auditLogs.action, "opportunity.milestone.build")));
    expect(audits).toHaveLength(1);
  });

  it("refuses to build without a due date, but still takes a milestone by hand", async () => {
    await db.update(opportunities).set({ responseDueDate: null }).where(eq(opportunities.id, opp()));
    expect(await buildSchedule({ organizationId: org(), opportunityId: opp(), actor: actorA() })).toEqual({ ok: true, added: 1 });
    expect((await loadSchedule({ organizationId: org(), opportunityId: opp() }))!.milestones.map((m) => m.kind)).toEqual(["kick_off"]);
    expect((await buildSchedule({ organizationId: org(), opportunityId: opp(), actor: actorA() })).ok).toBe(false);
    const add = await addMilestone({ organizationId: org(), opportunityId: opp(), title: "Pricing review", kind: "pricing_complete", date: addDays(today, 5), ownerUserId: pm, notes: "", actor: actorA() });
    expect(add.ok).toBe(true);
    expect((await addMilestone({ organizationId: org(), opportunityId: opp(), title: "x", kind: "other", date: today, ownerUserId: outsider, notes: "", actor: actorA() })).ok).toBe(false);
  });

  it("moves, re-owns, marks and removes a milestone, each audited", async () => {
    await buildSchedule({ organizationId: org(), opportunityId: opp(), actor: actorA() });
    const red = (await loadSchedule({ organizationId: org(), opportunityId: opp() }))!.milestones.find((m) => m.kind === "red_team")!;
    expect((await updateMilestone({ organizationId: org(), opportunityId: opp(), milestoneId: red.id, patch: { date: addDays(today, 22), ownerUserId: pm }, actor: actorA() })).ok).toBe(true);
    expect((await updateMilestone({ organizationId: org(), opportunityId: opp(), milestoneId: red.id, patch: { status: "done" }, actor: actorA() })).ok).toBe(true);
    const [row] = await db.select({ date: opportunityMilestones.date, ownerUserId: opportunityMilestones.ownerUserId, status: opportunityMilestones.status }).from(opportunityMilestones).where(eq(opportunityMilestones.id, red.id));
    expect(row).toEqual({ date: addDays(today, 22), ownerUserId: pm, status: "done" });
    expect((await removeMilestone({ organizationId: org(), opportunityId: opp(), milestoneId: red.id, actor: actorA() })).ok).toBe(true);
    expect((await removeMilestone({ organizationId: org(), opportunityId: opp(), milestoneId: red.id, actor: actorA() })).ok).toBe(false);
    const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(and(eq(auditLogs.organizationId, org()), eq(auditLogs.resourceId, red.id)));
    expect(audits.map((a) => a.action).sort()).toEqual(["opportunity.milestone.remove", "opportunity.milestone.update", "opportunity.milestone.update"]);
  });

  it("reminds the owner at T-7, T-3 and T-1 through the seeded default rule, once per day, and skips unowned rounds", async () => {
    await db.insert(solicitations).values({ organizationId: org(), opportunityId: opp(), title: "RFP" });
    await buildSchedule({ organizationId: org(), opportunityId: opp(), actor: actorA() });
    const owned = await addMilestone({ organizationId: org(), opportunityId: opp(), title: "Pricing complete", kind: "pricing_complete", date: addDays(today, 3), ownerUserId: pm, notes: "", actor: actorA() });
    await addMilestone({ organizationId: org(), opportunityId: opp(), title: "Nobody's", kind: "other", date: addDays(today, 3), ownerUserId: null, notes: "", actor: actorA() });
    await addMilestone({ organizationId: org(), opportunityId: opp(), title: "Not yet", kind: "other", date: addDays(today, 5), ownerUserId: pm, notes: "", actor: actorA() });

    const first = await dispatchMilestoneDueSoon();
    expect(first.errors).toBe(0);
    const rules = await db.select({ name: notificationRules.name, channels: notificationRules.channels }).from(notificationRules).where(and(eq(notificationRules.organizationId, org()), eq(notificationRules.triggerEventKind, "milestone_due_soon")));
    expect(rules).toEqual([{ name: "Default: Milestone due soon", channels: ["in_app", "email"] }]);
    const inbox = await db.select({ kind: notifications.kind, recipientUserId: notifications.recipientUserId, subject: notifications.subject, linkPath: notifications.linkPath }).from(notifications).where(eq(notifications.organizationId, org()));
    expect(inbox).toEqual([{ kind: "milestone_due_soon", recipientUserId: pm, subject: expect.stringContaining("[T-3] Pricing complete"), linkPath: `/opportunities/${opp()}/plan` }]);
    const deliveries = await db.select({ kind: notificationDeliveries.triggerEventKind }).from(notificationDeliveries).where(and(eq(notificationDeliveries.organizationId, org()), eq(notificationDeliveries.triggerEventKind, "milestone_due_soon")));
    expect(deliveries.length).toBeGreaterThan(0);

    // A retry the same day is deduplicated; a milestone marked done is left alone.
    const second = await dispatchMilestoneDueSoon();
    expect(second.duplicatesSkipped).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(notifications).where(eq(notifications.organizationId, org()))).toHaveLength(1);
    await updateMilestone({ organizationId: org(), opportunityId: opp(), milestoneId: (owned as { ok: true; id: string }).id, patch: { status: "done" }, actor: actorA() });
    const third = await dispatchMilestoneDueSoon(new Date(Date.now() + 25 * 60 * 60 * 1000));
    expect(third.remindersDispatched).toBe(0);
    expect(await db.select().from(notifications).where(eq(notifications.organizationId, fx.orgB.organizationId))).toEqual([]);
  });

  it("keeps everything inside the tenant", async () => {
    await buildSchedule({ organizationId: org(), opportunityId: opp(), actor: actorA() });
    const [ms] = await db.select({ id: opportunityMilestones.id }).from(opportunityMilestones).where(eq(opportunityMilestones.opportunityId, opp())).limit(1);
    const b = fx.orgB;
    const actorB = { userId: b.userId, email: "b@bl19-isolation.test", name: "Bo" };
    expect(await loadSchedule({ organizationId: b.organizationId, opportunityId: opp() })).toBeNull();
    expect((await buildSchedule({ organizationId: b.organizationId, opportunityId: opp(), actor: actorB })).ok).toBe(false);
    expect((await addMilestone({ organizationId: b.organizationId, opportunityId: opp(), title: "x", kind: "other", date: today, ownerUserId: null, notes: "", actor: actorB })).ok).toBe(false);
    expect((await updateMilestone({ organizationId: b.organizationId, opportunityId: opp(), milestoneId: ms.id, patch: { status: "done" }, actor: actorB })).ok).toBe(false);
    expect((await removeMilestone({ organizationId: b.organizationId, opportunityId: opp(), milestoneId: ms.id, actor: actorB })).ok).toBe(false);
    expect((await planSummaries(b.organizationId, [opp()])).get(opp())!.milestones).toBe(0);
    expect(await db.select().from(opportunityMilestones).where(eq(opportunityMilestones.opportunityId, opp()))).toHaveLength(6);
    expect(await db.select().from(opportunityMilestones).where(eq(opportunityMilestones.organizationId, b.organizationId))).toHaveLength(0);
  });
});
