/**
 * BL-FB-X-CRM — customer contacts against Postgres. Two tenants.
 * Asserts: a contact is created, read, updated and deleted through the
 * owning tenant only; the owner must be a member; touches roll their
 * dates up onto the contact and refuse another tenant's opportunity;
 * the opportunity panel matches by agency within the tenant; delete
 * cascades the history; everything audited.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, customerTouches, opportunities } from "@/db/schema";
import { contactsForOpportunity, deleteContact, getContact, listContacts, logTouch, saveContact } from "@/lib/crm";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

describe("BL-FB-X-CRM — customer contacts", () => {
  let fx: TwoTenantFixture;
  let contactA = "";
  const actorA = { userId: "", email: "a@test" };

  beforeEach(async () => {
    fx = await createTwoTenants("crm");
    actorA.userId = fx.orgA.userId;
    const created = await saveContact({
      organizationId: fx.orgA.organizationId,
      input: { agency: "  Department of the Navy ", office: "NAVSEA", name: "Ana Rivera", title: "KO", role: "contracting_officer", email: "Ana@Navy.mil", ownerUserId: fx.orgA.userId, nextTouchAt: "2026-12-01" },
      actor: actorA,
    });
    expect(created.ok).toBe(true);
    if (created.ok) contactA = created.id;
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("keeps contacts inside the owning tenant and validates the owner", async () => {
    const listA = await listContacts({ organizationId: fx.orgA.organizationId });
    expect(listA).toHaveLength(1);
    expect(listA[0]).toMatchObject({ agency: "Department of the Navy", agencyKey: "navy", name: "Ana Rivera", role: "contracting_officer", email: "ana@navy.mil", touchCount: 0 });
    expect(listA[0]!.ownerName).toContain("Test ");
    expect(await listContacts({ organizationId: fx.orgB.organizationId })).toEqual([]);
    expect(await getContact({ organizationId: fx.orgB.organizationId, contactId: contactA })).toBeNull();

    const foreignOwner = await saveContact({ organizationId: fx.orgA.organizationId, input: { agency: "Army", name: "Bo", ownerUserId: fx.orgB.userId }, actor: actorA });
    expect(foreignOwner).toEqual({ ok: false, error: "The owner must be a member of this organization." });
    expect((await saveContact({ organizationId: fx.orgA.organizationId, input: { agency: "", name: "Bo" }, actor: actorA })).ok).toBe(false);

    const foreignUpdate = await saveContact({ organizationId: fx.orgB.organizationId, contactId: contactA, input: { agency: "Navy", name: "Hijacked" }, actor: { userId: fx.orgB.userId } });
    expect(foreignUpdate).toEqual({ ok: false, error: "Contact not found." });
    const update = await saveContact({ organizationId: fx.orgA.organizationId, contactId: contactA, input: { agency: "Department of the Navy", name: "Ana Rivera", role: "cor", nextTouchAt: null }, actor: actorA });
    expect(update).toEqual({ ok: true, id: contactA });
    const after = await getContact({ organizationId: fx.orgA.organizationId, contactId: contactA });
    expect(after?.contact).toMatchObject({ role: "cor", nextTouchAt: null });

    expect(await deleteContact({ organizationId: fx.orgB.organizationId, contactId: contactA, actor: { userId: fx.orgB.userId } })).toEqual({ ok: false, error: "Contact not found." });
    const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.organizationId, fx.orgA.organizationId));
    expect(audits.filter((a) => a.action === "crm.contact.create")).toHaveLength(1);
    expect(audits.filter((a) => a.action === "crm.contact.update")).toHaveLength(1);
  });

  it("rolls touches up onto the contact, matches the opportunity's agency, cascades on delete", async () => {
    expect((await logTouch({ organizationId: fx.orgB.organizationId, contactId: contactA, input: { summary: "x" }, actor: { userId: fx.orgB.userId } })).ok).toBe(false);
    expect(await logTouch({ organizationId: fx.orgA.organizationId, contactId: contactA, input: { summary: "Industry day", opportunityId: fx.orgB.opportunityId }, actor: actorA })).toEqual({ ok: false, error: "Opportunity not found." });
    expect((await logTouch({ organizationId: fx.orgA.organizationId, contactId: contactA, input: { summary: "Time travel", occurredAt: new Date(Date.now() + 86_400_000).toISOString() }, actor: actorA })).ok).toBe(false);

    const first = await logTouch({
      organizationId: fx.orgA.organizationId,
      contactId: contactA,
      input: { kind: "meeting", occurredAt: "2026-09-01T15:00:00Z", summary: "Met at industry day; wants a capabilities brief.", opportunityId: fx.orgA.opportunityId, nextTouchAt: "2026-09-15" },
      actor: actorA,
    });
    expect(first.ok).toBe(true);
    let c = (await getContact({ organizationId: fx.orgA.organizationId, contactId: contactA }))!;
    expect(c.contact.lastTouchAt?.toISOString()).toBe("2026-09-01T15:00:00.000Z");
    expect(c.contact.nextTouchAt?.toISOString().slice(0, 10)).toBe("2026-09-15");
    expect(c.contact.touchCount).toBe(1);
    expect(c.touches).toHaveLength(1);
    expect(c.touches[0]).toMatchObject({ kind: "meeting", opportunityId: fx.orgA.opportunityId });
    expect(c.touches[0]!.loggedByName).toContain("Test ");

    // A later touch after the agreed date clears the follow-up; an older one never moves last-touch back.
    expect((await logTouch({ organizationId: fx.orgA.organizationId, contactId: contactA, input: { kind: "call", occurredAt: "2026-09-20T10:00:00Z", summary: "Sent the brief." }, actor: actorA })).ok).toBe(true);
    expect((await logTouch({ organizationId: fx.orgA.organizationId, contactId: contactA, input: { kind: "email", occurredAt: "2026-08-01T10:00:00Z", summary: "First intro, backfilled." }, actor: actorA })).ok).toBe(true);
    c = (await getContact({ organizationId: fx.orgA.organizationId, contactId: contactA }))!;
    expect(c.contact.lastTouchAt?.toISOString()).toBe("2026-09-20T10:00:00.000Z");
    expect(c.contact.nextTouchAt).toBeNull();
    expect(c.contact.touchCount).toBe(3);
    expect(c.touches.map((t) => t.kind)).toEqual(["call", "meeting", "email"]);

    await db.update(opportunities).set({ agency: "Navy" }).where(eq(opportunities.id, fx.orgA.opportunityId));
    await db.update(opportunities).set({ agency: "Navy" }).where(eq(opportunities.id, fx.orgB.opportunityId));
    const forA = await contactsForOpportunity({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId });
    expect(forA.agency).toBe("Navy");
    expect(forA.contacts.map((x) => x.id)).toEqual([contactA]);
    expect(forA.contacts[0]!.warmth).toBeGreaterThan(0);
    expect((await contactsForOpportunity({ organizationId: fx.orgB.organizationId, opportunityId: fx.orgB.opportunityId })).contacts).toEqual([]);
    expect((await contactsForOpportunity({ organizationId: fx.orgB.organizationId, opportunityId: fx.orgA.opportunityId })).contacts).toEqual([]);

    expect(await deleteContact({ organizationId: fx.orgA.organizationId, contactId: contactA, actor: actorA })).toEqual({ ok: true });
    expect(await db.select({ id: customerTouches.id }).from(customerTouches).where(eq(customerTouches.contactId, contactA))).toEqual([]);
    const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.organizationId, fx.orgA.organizationId));
    expect(audits.filter((a) => a.action === "crm.touch.log")).toHaveLength(3);
    expect(audits.filter((a) => a.action === "crm.contact.delete")).toHaveLength(1);
    expect((await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.organizationId, fx.orgB.organizationId))).filter((a) => a.action.startsWith("crm."))).toEqual([]);
  });
});
