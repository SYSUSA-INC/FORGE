/**
 * BL-NAV-LIFECYCLE 5b-2b — buying a prepaid search pack through Stripe.
 * Against a real Postgres, with `@/lib/stripe` mocked as in webhook.test.ts.
 * Asserts: a paid pack session credits the tenant once, however many times
 * Stripe delivers or replays it; an unpaid session credits nothing; the
 * searches come from the catalogue, not the session; a session whose
 * metadata names another tenant is refused; a refund takes back only the
 * unused searches of the tenant that bought, and never below zero; a
 * refund of anything else does nothing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import { auditLogs, paymentEvents, searchCreditEntries, tenantSubscriptions } from "@/db/schema";
import { createTierAndSubscribe, createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

let nextEventToReturn: unknown = null;

vi.mock("@/lib/stripe", async () => ({
  HANDLED_EVENT_TYPES: new Set<string>([
    "checkout.session.completed",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed",
    "charge.refunded",
  ]),
  getWebhookSecret: () => "whsec_test_fake_secret",
  getStripeClient: () => ({
    webhooks: { constructEvent: () => nextEventToReturn },
    checkout: { sessions: { listLineItems: async () => ({ data: [] }) } },
  }),
}));

import { POST as stripeWebhookPOST } from "@/app/api/webhooks/stripe/route";
import { drawSearchCredits, getSearchCreditBalance } from "@/lib/search-credits";

const uid = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

async function deliver(event: { id: string; type: string; data: unknown }) {
  nextEventToReturn = event;
  const res = await stripeWebhookPOST(
    new NextRequest("http://localhost/api/webhooks/stripe", { method: "POST", headers: { "stripe-signature": "test-sig" }, body: JSON.stringify(event) }),
  );
  return res.json();
}

describe("BL-NAV-LIFECYCLE 5b-2b — search pack purchase", () => {
  let fx: TwoTenantFixture;
  let tiers: { cleanup: () => Promise<void> }[] = [];
  let customerA: string;
  const eventIds: string[] = [];

  const packSession = (over: Record<string, unknown> = {}, metadata: Record<string, unknown> = {}) => {
    const id = uid("evt_pack");
    eventIds.push(id);
    return {
      id,
      type: "checkout.session.completed",
      data: {
        object: {
          id: uid("cs_test"),
          customer: customerA,
          client_reference_id: fx.orgA.organizationId,
          payment_status: "paid",
          payment_intent: uid("pi_test"),
          subscription: null,
          // The session claims 9,999 searches: the catalogue's 500 must win.
          metadata: { kind: "search_pack", organizationId: fx.orgA.organizationId, packSlug: "searches-500", searches: "9999", ...metadata },
          ...over,
        },
      },
    };
  };
  const refundEvent = (paymentIntent: string, amountRefunded: number, previous?: number) => {
    const id = uid("evt_refund");
    eventIds.push(id);
    return {
      id,
      type: "charge.refunded",
      data: {
        object: { id: uid("ch_test"), customer: customerA, payment_intent: paymentIntent, amount: 2500, amount_refunded: amountRefunded },
        ...(previous === undefined ? {} : { previous_attributes: { amount_refunded: previous } }),
      },
    };
  };
  const status = async (eventId: string) =>
    (await db.select({ s: paymentEvents.handlerStatus }).from(paymentEvents).where(eq(paymentEvents.stripeEventId, eventId)))[0]?.s;

  beforeEach(async () => {
    fx = await createTwoTenants("packbuy");
    const tag = uid("pb");
    tiers = [
      await createTierAndSubscribe({ organizationId: fx.orgA.organizationId, slug: `${tag}-a`, name: "PB A", featureFlags: { aiAutoDraft: true } }),
      await createTierAndSubscribe({ organizationId: fx.orgB.organizationId, slug: `${tag}-b`, name: "PB B", featureFlags: { aiAutoDraft: true } }),
    ];
    customerA = uid("cus_test");
    await db.update(tenantSubscriptions).set({ stripeCustomerId: customerA }).where(eq(tenantSubscriptions.organizationId, fx.orgA.organizationId));
  });

  afterEach(async () => {
    for (const id of eventIds.splice(0)) await db.delete(paymentEvents).where(eq(paymentEvents.stripeEventId, id));
    for (const t of tiers) await t.cleanup();
    await fx.cleanup();
  });

  it("credits a paid pack once, from the catalogue, to the buying tenant only", async () => {
    const orgA = fx.orgA.organizationId;
    const event = packSession();
    expect(await deliver(event)).toMatchObject({ ok: true, handled: true });
    expect(await status(event.id)).toBe("ok");
    expect(await getSearchCreditBalance(orgA)).toBe(500);
    expect(await getSearchCreditBalance(fx.orgB.organizationId)).toBe(0);

    // The same event again: dropped by payment_event.
    expect(await deliver(event)).toMatchObject({ deduped: true });
    // The same session under a new event id (a replay): dropped by the ledger's unique session id.
    const replay = { ...event, id: uid("evt_pack_replay") };
    eventIds.push(replay.id);
    await deliver(replay);
    expect(await getSearchCreditBalance(orgA)).toBe(500);

    const entries = await db.select().from(searchCreditEntries).where(eq(searchCreditEntries.organizationId, orgA));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "purchase", delta: 500, balanceAfter: 500, packSlug: "searches-500" });
    const audit = await db.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.organizationId, orgA), eq(auditLogs.action, "billing.search_pack.credited")));
    expect(audit).toHaveLength(1);
  });

  it("credits nothing for an unpaid session, an unknown pack, or a session naming another tenant", async () => {
    const orgA = fx.orgA.organizationId;
    await deliver(packSession({ payment_status: "unpaid" }));
    const unknown = packSession({}, { packSlug: "no-such-pack" });
    await deliver(unknown);
    expect(await status(unknown.id)).toBe("failed");
    // Tenant A's customer, but the metadata names tenant B: refused, neither is credited.
    const crossed = packSession({}, { organizationId: fx.orgB.organizationId });
    await deliver(crossed);
    expect(await status(crossed.id)).toBe("failed");
    expect(await getSearchCreditBalance(orgA)).toBe(0);
    expect(await getSearchCreditBalance(fx.orgB.organizationId)).toBe(0);
    expect(await db.select({ id: searchCreditEntries.id }).from(searchCreditEntries).where(eq(searchCreditEntries.organizationId, orgA))).toHaveLength(0);
  });

  it("a refund takes back only unused searches, of the buyer only, and never below zero", async () => {
    const orgA = fx.orgA.organizationId;
    const purchase = packSession();
    const paymentIntent = purchase.data.object.payment_intent as string;
    await deliver(purchase);

    // A refund of some other payment (a plan invoice) does nothing.
    await deliver(refundEvent(uid("pi_other"), 2500));
    expect(await getSearchCreditBalance(orgA)).toBe(500);

    // A partial refund of $5 of $25 takes back 100 of the 500.
    await deliver(refundEvent(paymentIntent, 500));
    expect(await getSearchCreditBalance(orgA)).toBe(400);

    // 350 are then used; the rest of the refund is owed 400 but only 50 are left.
    expect(await drawSearchCredits({ organizationId: orgA, want: 350 })).toBe(350);
    const rest = refundEvent(paymentIntent, 2500, 500);
    await deliver(rest);
    expect(await status(rest.id)).toBe("ok");
    expect(await getSearchCreditBalance(orgA)).toBe(0);
    expect(await getSearchCreditBalance(fx.orgB.organizationId)).toBe(0);

    const refunds = await db
      .select({ delta: searchCreditEntries.delta, note: searchCreditEntries.note })
      .from(searchCreditEntries)
      .where(and(eq(searchCreditEntries.organizationId, orgA), eq(searchCreditEntries.kind, "refund")));
    expect(refunds.map((r) => r.delta).sort((a, b) => a - b)).toEqual([-100, -50]);
    expect(refunds.some((r) => r.note.includes("already used"))).toBe(true);
    const audit = await db.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.organizationId, orgA), eq(auditLogs.action, "billing.search_pack.refunded")));
    expect(audit).toHaveLength(2);
  });
});
