import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, memberships, notificationDeliveries, notificationRules, notifications, proposalSections, users } from "@/db/schema";
import { addDays, isoDay } from "@/lib/milestone-logic";
import { planSummaries } from "@/lib/plan-store";
import { dispatchSectionOverdue } from "@/lib/section-overdue-cron";
import { loadParts, setPartDueDate, setPartOwner } from "@/lib/section-plan-store";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

vi.mock("@/lib/email", () => ({
  emailConfigured: () => false,
  sendRuleNotificationEmail: vi.fn(async () => undefined),
}));

/**
 * BL-NAV-LIFECYCLE 4b-2 — the parts on the Plan tab: the proposal's
 * sections with an owner and a due date each, set in Plan and audited;
 * naming an owner tells them with the date; the daily cron tells the
 * owner of a part past its date with no draft, once per date, through
 * the seeded default rule; nothing crosses tenants.
 */
describe("BL-NAV-LIFECYCLE 4b-2 — the parts, their due dates and the overdue notice", () => {
  let fx: TwoTenantFixture;
  let writer: string;
  let outsider: string;
  let techId: string;
  let mgmtId: string;
  const today = isoDay(new Date());
  const tag = () => `sp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  beforeEach(async () => {
    fx = await createTwoTenants("section-plan");
    writer = `wr-${tag()}`;
    outsider = `out-${tag()}`;
    await db.insert(users).values([
      { id: writer, name: "Wen Writer", email: `${writer}@bl19-isolation.test` },
      { id: outsider, name: "Other Org", email: `${outsider}@bl19-isolation.test` },
    ]);
    await db.insert(memberships).values([
      { userId: writer, organizationId: fx.orgA.organizationId, role: "proposal", status: "active" },
      { userId: outsider, organizationId: fx.orgB.organizationId, role: "proposal", status: "active" },
    ]);
    const rows = await db
      .insert(proposalSections)
      .values([
        { proposalId: fx.orgA.proposalId, kind: "technical", title: "Technical approach", ordering: 1 },
        { proposalId: fx.orgA.proposalId, kind: "management", title: "Management plan", ordering: 2, status: "in_progress", content: "A first paragraph.", wordCount: 3 },
        { proposalId: fx.orgB.proposalId, kind: "technical", title: "B's section", ordering: 1 },
      ])
      .returning({ id: proposalSections.id, title: proposalSections.title });
    techId = rows.find((r) => r.title === "Technical approach")!.id;
    mgmtId = rows.find((r) => r.title === "Management plan")!.id;
    // Migration 0080 seeded proposal_section_assigned for the tenants that existed then; this one is new, so give it the same rule.
    await db.insert(notificationRules).values({
      organizationId: fx.orgA.organizationId,
      name: "Default: Proposal section assigned",
      triggerEventKind: "proposal_section_assigned",
      recipientStrategy: "mentioned_in_payload",
      channels: ["in_app", "email"],
      frequency: "immediate",
    });
  });

  afterEach(async () => {
    await fx.cleanup();
    await db.delete(users).where(eq(users.id, writer));
    await db.delete(users).where(eq(users.id, outsider));
  });

  const actorA = () => ({ userId: fx.orgA.userId, email: "a@bl19-isolation.test", name: "Ana Owner" });
  const org = () => fx.orgA.organizationId;
  const opp = () => fx.orgA.opportunityId;

  it("lists the proposal's sections as parts, sets the owner and the date, each audited, and counts them in the plan's state", async () => {
    const before = await loadParts({ organizationId: org(), opportunityId: opp() });
    expect(before!.proposals).toHaveLength(1);
    expect(before!.parts.map((p) => [p.title, p.authorUserId, p.dueDate, p.hasDraft, p.overdue])).toEqual([
      ["Technical approach", null, null, false, false],
      ["Management plan", null, null, true, false],
    ]);
    expect(before!.count).toEqual({ total: 2, owned: 0, dated: 0 });

    expect(await setPartDueDate({ organizationId: org(), opportunityId: opp(), sectionId: techId, dueDate: addDays(today, 5), actor: actorA() })).toEqual({ ok: true, id: techId });
    expect(await setPartOwner({ organizationId: org(), opportunityId: opp(), sectionId: techId, authorUserId: writer, actor: actorA() })).toEqual({ ok: true, id: techId });
    expect((await setPartOwner({ organizationId: org(), opportunityId: opp(), sectionId: techId, authorUserId: outsider, actor: actorA() })).ok).toBe(false);

    const after = await loadParts({ organizationId: org(), opportunityId: opp() });
    expect(after!.parts[0]).toMatchObject({ authorUserId: writer, authorName: "Wen Writer", dueDate: addDays(today, 5) });
    expect(after!.count).toEqual({ total: 2, owned: 1, dated: 1 });
    const state = (await planSummaries(org(), [opp()])).get(opp())!;
    expect(state.parts).toEqual({ total: 2, owned: 1, dated: 1 });

    // The owner was told, with the date, through the seeded proposal_section_assigned rule.
    const inbox = await db.select({ kind: notifications.kind, recipientUserId: notifications.recipientUserId, body: notifications.body, linkPath: notifications.linkPath }).from(notifications).where(eq(notifications.organizationId, org()));
    expect(inbox).toEqual([{ kind: "review_section_assigned", recipientUserId: writer, body: expect.stringContaining(`It is due ${addDays(today, 5)}.`), linkPath: `/proposals/${fx.orgA.proposalId}/sections` }]);

    const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(and(eq(auditLogs.organizationId, org()), eq(auditLogs.resourceId, techId)));
    expect(audits.map((a) => a.action).sort()).toEqual(["proposal.section.due_date.set", "proposal.section.owner.set"]);

    // Clearing the date, and naming yourself, are silent.
    expect((await setPartDueDate({ organizationId: org(), opportunityId: opp(), sectionId: techId, dueDate: null, actor: actorA() })).ok).toBe(true);
    expect((await setPartOwner({ organizationId: org(), opportunityId: opp(), sectionId: mgmtId, authorUserId: fx.orgA.userId, actor: actorA() })).ok).toBe(true);
    expect(await db.select().from(notifications).where(eq(notifications.organizationId, org()))).toHaveLength(1);
  });

  it("tells the owner of a part past its date with no draft, once per date, and leaves drafted and undated parts alone", async () => {
    await setPartOwner({ organizationId: org(), opportunityId: opp(), sectionId: techId, authorUserId: writer, actor: actorA() });
    await setPartDueDate({ organizationId: org(), opportunityId: opp(), sectionId: techId, dueDate: addDays(today, -2), actor: actorA() });
    // Drafted and overdue: not told. Owned by nobody: not told.
    await setPartOwner({ organizationId: org(), opportunityId: opp(), sectionId: mgmtId, authorUserId: writer, actor: actorA() });
    await setPartDueDate({ organizationId: org(), opportunityId: opp(), sectionId: mgmtId, dueDate: addDays(today, -2), actor: actorA() });
    await db.delete(notifications).where(eq(notifications.organizationId, org()));

    const first = await dispatchSectionOverdue();
    expect(first.errors).toBe(0);
    expect(first.remindersDispatched).toBe(1);
    const rules = await db.select({ name: notificationRules.name, channels: notificationRules.channels }).from(notificationRules).where(and(eq(notificationRules.organizationId, org()), eq(notificationRules.triggerEventKind, "proposal_section_overdue")));
    expect(rules).toEqual([{ name: "Default: Proposal section overdue", channels: ["in_app", "email"] }]);
    const inbox = await db.select({ kind: notifications.kind, recipientUserId: notifications.recipientUserId, subject: notifications.subject, linkPath: notifications.linkPath }).from(notifications).where(eq(notifications.organizationId, org()));
    expect(inbox).toEqual([{ kind: "proposal_section_overdue", recipientUserId: writer, subject: expect.stringContaining("Overdue: Technical approach"), linkPath: `/proposals/${fx.orgA.proposalId}/sections` }]);
    const parts = await loadParts({ organizationId: org(), opportunityId: opp() });
    expect(parts!.parts.map((p) => p.overdue)).toEqual([true, false]);

    // The next day's run is deduplicated; a moved date that passes again fires again.
    const second = await dispatchSectionOverdue(new Date(Date.now() + 25 * 60 * 60 * 1000));
    expect(second.duplicatesSkipped).toBe(1);
    expect(second.remindersDispatched).toBe(0);
    await setPartDueDate({ organizationId: org(), opportunityId: opp(), sectionId: techId, dueDate: addDays(today, -1), actor: actorA() });
    const third = await dispatchSectionOverdue();
    expect(third.remindersDispatched).toBe(1);
    expect(await db.select().from(notifications).where(eq(notifications.organizationId, org()))).toHaveLength(2);
    const deliveries = await db.select({ kind: notificationDeliveries.triggerEventKind }).from(notificationDeliveries).where(and(eq(notificationDeliveries.organizationId, org()), eq(notificationDeliveries.triggerEventKind, "proposal_section_overdue")));
    // The ledger holds one row per recipient per channel: two dispatches, in-app and email each.
    expect(deliveries).toHaveLength(4);
    expect(await db.select().from(notifications).where(eq(notifications.organizationId, fx.orgB.organizationId))).toEqual([]);
  });

  it("keeps everything inside the tenant", async () => {
    const b = fx.orgB;
    const actorB = { userId: b.userId, email: "b@bl19-isolation.test", name: "Bo" };
    expect(await loadParts({ organizationId: b.organizationId, opportunityId: opp() })).toBeNull();
    expect((await loadParts({ organizationId: b.organizationId, opportunityId: b.opportunityId }))!.parts.map((p) => p.title)).toEqual(["B's section"]);
    expect((await setPartOwner({ organizationId: b.organizationId, opportunityId: opp(), sectionId: techId, authorUserId: outsider, actor: actorB })).ok).toBe(false);
    expect((await setPartOwner({ organizationId: b.organizationId, opportunityId: b.opportunityId, sectionId: techId, authorUserId: outsider, actor: actorB })).ok).toBe(false);
    expect((await setPartDueDate({ organizationId: b.organizationId, opportunityId: b.opportunityId, sectionId: techId, dueDate: today, actor: actorB })).ok).toBe(false);
    const [row] = await db.select({ authorUserId: proposalSections.authorUserId, dueDate: proposalSections.dueDate }).from(proposalSections).where(eq(proposalSections.id, techId));
    expect(row).toEqual({ authorUserId: null, dueDate: null });
    expect((await planSummaries(b.organizationId, [opp()])).get(opp())!.parts).toEqual({ total: 0, owned: 0, dated: 0 });
  });
});
