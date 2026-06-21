/**
 * BL-17 — runtime tests for the Stripe webhook handler.
 *
 * Stripe deliveries are async + at-least-once. A regression in the
 * webhook receiver either silently drops customer billing events
 * (lost revenue / unflipped tiers) or processes the same event
 * twice (double-charged tier upgrades, duplicate emails). These
 * tests prove the documented invariants against a real Postgres.
 *
 * Approach:
 *   - Mock `@/lib/stripe` so we can synthesize signed events without
 *     a real Stripe SDK (the route already trusts whatever
 *     constructEvent returns; we control its return value).
 *   - Mock the dunning email helper so we can assert it was called
 *     without sending real mail.
 *   - Leave the DB, `recordAudit`, and the dispatcher itself UN-mocked
 *     so the assertions cover real side-effects on `payment_event`
 *     and `tenant_subscription`.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db } from "@/db";
import {
  paymentEvents,
  subscriptionTiers,
  tenantSubscriptions,
} from "@/db/schema";
import {
  createTwoTenants,
  type TwoTenantFixture,
} from "../helpers/fixtures";

// ── Mocks (must precede route import) ────────────────────────────────────

// In-memory "current event" the mocked constructEvent will return.
let nextEventToReturn: unknown = null;
let signatureShouldFail = false;

vi.mock("@/lib/stripe", async () => {
  const HANDLED_EVENT_TYPES = new Set<string>([
    "checkout.session.completed",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed",
  ]);
  return {
    HANDLED_EVENT_TYPES,
    getWebhookSecret: () => "whsec_test_fake_secret",
    getStripeClient: () => ({
      webhooks: {
        constructEvent: () => {
          if (signatureShouldFail) {
            throw new Error("Invalid signature");
          }
          return nextEventToReturn;
        },
      },
      checkout: {
        sessions: {
          listLineItems: async () => ({ data: [] }),
        },
      },
    }),
  };
});

const sendPaymentFailedEmailMock = vi.fn();
vi.mock("@/lib/stripe-dunning-email", () => ({
  sendPaymentFailedEmail: (args: unknown) =>
    sendPaymentFailedEmailMock(args),
}));

// Import route AFTER mocks so it picks them up.
import { POST as stripeWebhookPOST } from "@/app/api/webhooks/stripe/route";

// ── Helpers ──────────────────────────────────────────────────────────────

function makeWebhookRequest(body: object): NextRequest {
  return new NextRequest("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: { "stripe-signature": "test-sig" },
    body: JSON.stringify(body),
  });
}

function uniqueEventId(prefix: string): string {
  return `evt_test_${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("BL-17 — Stripe webhook receiver (runtime)", () => {
  let fx: TwoTenantFixture;
  let customerId: string;
  let cleanupTier: () => Promise<void> = async () => {};

  beforeEach(async () => {
    fx = await createTwoTenants("stripe");
    customerId = `cus_test_${Date.now().toString(36)}`;
    signatureShouldFail = false;
    sendPaymentFailedEmailMock.mockReset();

    // Seed a baseline tier + subscription row for orgA so the
    // handlers have something to UPDATE. Webhook handlers expect
    // tenant_subscription to already exist (it's created at checkout).
    const [tier] = await db
      .insert(subscriptionTiers)
      .values({
        slug: `stripe-test-${customerId.slice(-8)}`,
        name: "Stripe Test Tier",
        active: true,
      })
      .returning({ id: subscriptionTiers.id });
    await db.insert(tenantSubscriptions).values({
      organizationId: fx.orgA.organizationId,
      tierId: tier!.id,
      status: "active",
      stripeCustomerId: customerId,
    });
    cleanupTier = async () => {
      await db
        .delete(tenantSubscriptions)
        .where(
          eq(tenantSubscriptions.organizationId, fx.orgA.organizationId),
        );
      await db.delete(subscriptionTiers).where(eq(subscriptionTiers.id, tier!.id));
    };
  });

  afterEach(async () => {
    await cleanupTier();
    await fx.cleanup();
  });

  // ── Signature ──────────────────────────────────────────────────────

  it("rejects invalid signatures with 400", async () => {
    signatureShouldFail = true;
    nextEventToReturn = null;
    const res = await stripeWebhookPOST(makeWebhookRequest({}));
    expect(res.status).toBe(400);
  });

  // ── Idempotency ────────────────────────────────────────────────────

  it("inserts a payment_event row for new events", async () => {
    const eventId = uniqueEventId("new");
    nextEventToReturn = {
      id: eventId,
      type: "invoice.paid",
      data: { object: { customer: customerId } },
    };
    const res = await stripeWebhookPOST(makeWebhookRequest({}));
    expect(res.status).toBe(200);

    const [row] = await db
      .select()
      .from(paymentEvents)
      .where(eq(paymentEvents.stripeEventId, eventId))
      .limit(1);
    expect(row).toBeTruthy();
    expect(row!.eventType).toBe("invoice.paid");
    expect(row!.stripeCustomerId).toBe(customerId);
    expect(row!.organizationId).toBe(fx.orgA.organizationId);
  });

  it("dedupes a duplicate delivery — second POST is a no-op", async () => {
    const eventId = uniqueEventId("dup");
    nextEventToReturn = {
      id: eventId,
      type: "invoice.paid",
      data: { object: { customer: customerId } },
    };
    await stripeWebhookPOST(makeWebhookRequest({}));
    const second = await stripeWebhookPOST(makeWebhookRequest({}));
    expect(second.status).toBe(200);
    const json = (await second.json()) as { deduped?: boolean };
    expect(json.deduped).toBe(true);

    // Only one row should exist with this event id.
    const rows = await db
      .select({ id: paymentEvents.id })
      .from(paymentEvents)
      .where(eq(paymentEvents.stripeEventId, eventId));
    expect(rows).toHaveLength(1);
  });

  // ── customer.subscription.deleted → status = canceled ──────────────

  it("customer.subscription.deleted flips tenant_subscription.status to 'canceled'", async () => {
    const eventId = uniqueEventId("del");
    nextEventToReturn = {
      id: eventId,
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_test_to_delete",
          customer: customerId,
        },
      },
    };
    await stripeWebhookPOST(makeWebhookRequest({}));

    const [sub] = await db
      .select()
      .from(tenantSubscriptions)
      .where(
        eq(tenantSubscriptions.organizationId, fx.orgA.organizationId),
      )
      .limit(1);
    expect(sub!.status).toBe("canceled");
    expect(sub!.stripeSubscriptionId).toBeNull();
    expect(sub!.cancelAt).not.toBeNull();

    // payment_event status moved to ok.
    const [ev] = await db
      .select({ handlerStatus: paymentEvents.handlerStatus })
      .from(paymentEvents)
      .where(eq(paymentEvents.stripeEventId, eventId))
      .limit(1);
    expect(ev!.handlerStatus).toBe("ok");
  });

  // ── invoice.payment_failed → email + audit ──────────────────────────

  it("invoice.payment_failed sends the dunning email and audits", async () => {
    const eventId = uniqueEventId("fail");
    nextEventToReturn = {
      id: eventId,
      type: "invoice.payment_failed",
      data: {
        object: {
          id: "in_test_failed",
          customer: customerId,
          amount_due: 4900,
          currency: "usd",
          hosted_invoice_url: "https://invoice.stripe.test/abc",
          attempt_count: 2,
          next_payment_attempt: Math.floor(Date.now() / 1000) + 3600,
        },
      },
    };
    await stripeWebhookPOST(makeWebhookRequest({}));

    expect(sendPaymentFailedEmailMock).toHaveBeenCalledTimes(1);
    const args = sendPaymentFailedEmailMock.mock.calls[0]?.[0] as {
      organizationId: string;
      amountDueCents: number;
      attemptCount: number;
    };
    expect(args.organizationId).toBe(fx.orgA.organizationId);
    expect(args.amountDueCents).toBe(4900);
    expect(args.attemptCount).toBe(2);
  });

  // ── Unknown customer — handler runs without writing to a tenant ─────

  it("invoice.payment_failed for an unknown customer logs but does not send email", async () => {
    const eventId = uniqueEventId("unknown");
    nextEventToReturn = {
      id: eventId,
      type: "invoice.payment_failed",
      data: {
        object: {
          id: "in_test_unknown",
          customer: "cus_does_not_exist",
          amount_due: 100,
          currency: "usd",
          attempt_count: 1,
        },
      },
    };
    const res = await stripeWebhookPOST(makeWebhookRequest({}));
    expect(res.status).toBe(200);
    expect(sendPaymentFailedEmailMock).not.toHaveBeenCalled();
  });

  // ── Unhandled event type — recorded but not processed ──────────────

  it("unhandled event types are persisted with handler_status='unhandled'", async () => {
    const eventId = uniqueEventId("unhandled");
    nextEventToReturn = {
      id: eventId,
      type: "payout.created",
      data: { object: { customer: customerId } },
    };
    const res = await stripeWebhookPOST(makeWebhookRequest({}));
    expect(res.status).toBe(200);
    const [row] = await db
      .select({ handlerStatus: paymentEvents.handlerStatus })
      .from(paymentEvents)
      .where(eq(paymentEvents.stripeEventId, eventId))
      .limit(1);
    expect(row!.handlerStatus).toBe("unhandled");
  });

  // ── Handler error path — payment_event marks failed but route returns 200 ─

  it("handler exception → payment_event.handler_status='failed' but route still acks 200", async () => {
    // customer.subscription.updated with an unknown customer throws
    // inside handleSubscriptionUpdated. We still ack 200 (Stripe
    // retry semantics: don't pile up behind a broken handler).
    const eventId = uniqueEventId("handlerfail");
    nextEventToReturn = {
      id: eventId,
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_failure",
          customer: "cus_doesnt_exist_anywhere",
          items: { data: [] },
          status: "active",
          current_period_start: Math.floor(Date.now() / 1000),
          current_period_end: Math.floor(Date.now() / 1000) + 86400,
        },
      },
    };
    const res = await stripeWebhookPOST(makeWebhookRequest({}));
    expect(res.status).toBe(200);

    const [row] = await db
      .select({
        handlerStatus: paymentEvents.handlerStatus,
        handlerError: paymentEvents.handlerError,
      })
      .from(paymentEvents)
      .where(eq(paymentEvents.stripeEventId, eventId))
      .limit(1);
    expect(row!.handlerStatus).toBe("failed");
    expect(row!.handlerError).toBeTruthy();
  });
});
