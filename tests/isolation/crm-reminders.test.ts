/**
 * BL-FB-X-CRM Slice 2 — follow-up reminders and the agency panel against
 * Postgres. Two tenants. Asserts: the daily reminder reaches only the
 * relationship owner, once per agreed date, and re-arms when the date
 * changes; a contact with no owner is counted and skipped; the other
 * tenant's due contact never produces a delivery in the first tenant;
 * contacts for an agency named free-form stay inside the tenant; the
 * procurement lookup refuses cleanly while the awards flag is off.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { customerContacts, notificationDeliveries, notificationRules } from "@/db/schema";
import { contactsForAgencyName, saveContact } from "@/lib/crm";
import { agencyProcurementHistory } from "@/lib/crm-history";
import { dispatchContactTouchReminders } from "@/lib/crm-reminders";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const HOUR = 3_600_000;

describe("BL-FB-X-CRM Slice 2 — follow-up reminders", () => {
  let fx: TwoTenantFixture;
  let ruleA = "";
  let owned = "";
  let unowned = "";
  let foreign = "";
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 20 * HOUR);

  beforeEach(async () => {
    fx = await createTwoTenants("crm-reminders");
    const [rule] = await db
      .insert(notificationRules)
      .values({
        organizationId: fx.orgA.organizationId,
        name: "Test: contact follow-up due",
        triggerEventKind: "contact_touch_due",
        recipientStrategy: "mentioned_in_payload",
        channels: ["in_app"],
        frequency: "immediate",
        active: true,
      })
      .returning({ id: notificationRules.id });
    ruleA = rule!.id;
    const actorA = { userId: fx.orgA.userId, email: "a@test" };
    const a = await saveContact({ organizationId: fx.orgA.organizationId, input: { agency: "Department of the Navy", name: "Ana Rivera", ownerUserId: fx.orgA.userId, nextTouchAt: tomorrow.toISOString() }, actor: actorA });
    const b = await saveContact({ organizationId: fx.orgA.organizationId, input: { agency: "Navy", name: "Nobody Owns", nextTouchAt: tomorrow.toISOString() }, actor: actorA });
    const c = await saveContact({ organizationId: fx.orgB.organizationId, input: { agency: "Navy", name: "Other Tenant", ownerUserId: fx.orgB.userId, nextTouchAt: tomorrow.toISOString() }, actor: { userId: fx.orgB.userId } });
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (a.ok) owned = a.id;
    if (b.ok) unowned = b.id;
    if (c.ok) foreign = c.id;
    // Not due yet: next week.
    await saveContact({ organizationId: fx.orgA.organizationId, input: { agency: "Army", name: "Later", ownerUserId: fx.orgA.userId, nextTouchAt: new Date(now.getTime() + 7 * 24 * HOUR).toISOString() }, actor: actorA });
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  async function deliveriesA() {
    return db
      .select({ recipientUserId: notificationDeliveries.recipientUserId })
      .from(notificationDeliveries)
      .where(and(eq(notificationDeliveries.organizationId, fx.orgA.organizationId), eq(notificationDeliveries.ruleId, ruleA)));
  }
  async function stamp(id: string) {
    const [row] = await db.select({ at: customerContacts.touchReminderFor }).from(customerContacts).where(eq(customerContacts.id, id));
    return row!.at;
  }

  it("reminds the owner once per agreed date, skips unowned contacts, re-arms on a new date", async () => {
    const first = await dispatchContactTouchReminders(now);
    expect(first.contactsDue).toBeGreaterThanOrEqual(3);
    expect(first.unowned).toBeGreaterThanOrEqual(1);
    expect(first.errors).toBe(0);
    expect((await deliveriesA()).map((d) => d.recipientUserId)).toEqual([fx.orgA.userId]);
    expect((await stamp(owned))?.getTime()).toBe((await db.select({ n: customerContacts.nextTouchAt }).from(customerContacts).where(eq(customerContacts.id, owned)))[0]!.n!.getTime());
    expect(await stamp(unowned)).toBeNull();
    // Tenant B has no rule: nothing delivered there, but the contact is stamped so it is not retried daily.
    expect(await db.select({ id: notificationDeliveries.id }).from(notificationDeliveries).where(eq(notificationDeliveries.organizationId, fx.orgB.organizationId))).toEqual([]);
    expect(await stamp(foreign)).not.toBeNull();

    await dispatchContactTouchReminders(now);
    expect(await deliveriesA()).toHaveLength(1);

    // The owner logs the touch and agrees a new date within the horizon (overdue by now): one more reminder.
    const yesterday = new Date(now.getTime() - 24 * HOUR);
    await db.update(customerContacts).set({ nextTouchAt: yesterday }).where(and(eq(customerContacts.id, owned), eq(customerContacts.organizationId, fx.orgA.organizationId)));
    const third = await dispatchContactTouchReminders(now);
    expect(third.remindersDispatched).toBe(1);
    expect(await deliveriesA()).toHaveLength(2);
    expect((await stamp(owned))?.getTime()).toBe(yesterday.getTime());
  });

  it("finds the people at an agency named free-form inside the tenant only, and gates the procurement lookup", async () => {
    const navyA = await contactsForAgencyName({ organizationId: fx.orgA.organizationId, agency: "U.S. Navy" });
    expect(navyA.map((c) => c.name).sort()).toEqual(["Ana Rivera", "Nobody Owns"]);
    expect(navyA[0]!.warmth).toBeGreaterThanOrEqual(0);
    expect((await contactsForAgencyName({ organizationId: fx.orgB.organizationId, agency: "Navy" })).map((c) => c.id)).toEqual([foreign]);
    expect(await contactsForAgencyName({ organizationId: fx.orgA.organizationId, agency: "  " })).toEqual([]);
    expect(await contactsForAgencyName({ organizationId: fx.orgA.organizationId, agency: "NASA" })).toEqual([]);

    const flag = process.env.AWARDS_INTEL_ENABLED;
    delete process.env.AWARDS_INTEL_ENABLED;
    try {
      const res = await agencyProcurementHistory({ organizationId: fx.orgA.organizationId, agency: "Navy", actor: { userId: fx.orgA.userId } });
      expect(res).toMatchObject({ ok: false, disabled: true });
    } finally {
      if (flag !== undefined) process.env.AWARDS_INTEL_ENABLED = flag;
    }
  });
});
