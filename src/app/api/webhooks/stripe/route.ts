import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { db } from "@/db";
import {
  paymentEvents,
  tenantSubscriptions,
} from "@/db/schema";
import {
  getStripeClient,
  getWebhookSecret,
  HANDLED_EVENT_TYPES,
} from "@/lib/stripe";
import { log } from "@/lib/log";
import { recordAudit } from "@/lib/audit-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * BL-17 Slice 2 — Stripe webhook receiver.
 *
 * Flow:
 *   1. Verify the request signature against STRIPE_WEBHOOK_SECRET.
 *      Reject 400 if invalid — never trust an unsigned payload.
 *   2. INSERT into payment_event ON CONFLICT DO NOTHING — idempotency.
 *      A retried delivery hits the unique constraint and we return 200
 *      without re-processing.
 *   3. Resolve the tenant by `stripeCustomerId` from the payload, when
 *      present. Update payment_event.organization_id for the audit
 *      trail.
 *   4. Dispatch to the per-event handler. Each handler updates the
 *      tenant subscription row inside a try/catch; failures write
 *      handler_status='failed' + handler_error and we still return
 *      200 to Stripe (their replay will hit our idempotency dedup).
 *
 * Why always-200: Stripe retries 4xx and 5xx responses with backoff.
 * Returning 500 on a handler bug means Stripe hammers us for ~3 days
 * (per their retry schedule), and meanwhile every new event piles up
 * behind the broken one. Recording the failure + ack'ing lets us fix
 * forward via the admin UI in Slice 4. Genuine signature failures
 * still return 400 — those are SECURITY checks, not handler bugs.
 *
 * Signature verification requires the RAW body bytes (not parsed
 * JSON), so we read text() directly and pass to constructEvent.
 */
export async function POST(req: NextRequest) {
  const sigHeader = req.headers.get("stripe-signature") || "";

  // 1) Signature verification — read raw body.
  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    const stripe = getStripeClient();
    event = stripe.webhooks.constructEvent(
      rawBody,
      sigHeader,
      getWebhookSecret(),
    );
  } catch (err) {
    // Bad signature OR missing config. Return 400 — Stripe won't retry
    // 400s, so we won't hammer ourselves on a misconfig.
    log.error("[stripe-webhook]", "signature verification failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { ok: false, error: "invalid signature or missing webhook secret" },
      { status: 400 },
    );
  }

  // Stripe customer id from the payload, when the event carries one.
  // Most subscription/invoice events do; some platform-level events
  // (e.g. `payout.*`) don't and we ignore those.
  const stripeCustomerId = extractStripeCustomerId(event);

  // 2) Idempotency INSERT. The unique constraint on stripe_event_id
  // makes a retry a no-op at the DB layer.
  let isNewEvent = true;
  try {
    const inserted = await db
      .insert(paymentEvents)
      .values({
        stripeEventId: event.id,
        eventType: event.type,
        stripeCustomerId,
        payload: event as unknown as Record<string, unknown>,
        handlerStatus: HANDLED_EVENT_TYPES.has(event.type)
          ? "pending"
          : "unhandled",
      })
      .onConflictDoNothing({ target: paymentEvents.stripeEventId })
      .returning({ id: paymentEvents.id });
    isNewEvent = inserted.length > 0;
  } catch (err) {
    log.error("[stripe-webhook]", "could not persist payment_event", {
      error: err instanceof Error ? err.message : String(err),
      eventId: event.id,
    });
    // Persisting the audit row failed; still try the handler so the
    // user-visible side-effect doesn't get lost. The next replay from
    // Stripe should land cleanly.
  }

  if (!isNewEvent) {
    log.info("[stripe-webhook]", "duplicate event — idempotent skip", {
      eventId: event.id,
      eventType: event.type,
    });
    return NextResponse.json({ ok: true, deduped: true });
  }

  // 3) Resolve tenant if we have a customer id.
  let organizationId: string | null = null;
  if (stripeCustomerId) {
    const [tenant] = await db
      .select({ organizationId: tenantSubscriptions.organizationId })
      .from(tenantSubscriptions)
      .where(eq(tenantSubscriptions.stripeCustomerId, stripeCustomerId))
      .limit(1);
    organizationId = tenant?.organizationId ?? null;
    if (organizationId) {
      await db
        .update(paymentEvents)
        .set({ organizationId })
        .where(eq(paymentEvents.stripeEventId, event.id));
    }
  }

  // 4) Dispatch.
  if (!HANDLED_EVENT_TYPES.has(event.type)) {
    // Recorded with handler_status='unhandled' from the INSERT above.
    // Nothing more to do; future slices may opt in additional events.
    log.info("[stripe-webhook]", "received unhandled event type", {
      eventId: event.id,
      eventType: event.type,
    });
    return NextResponse.json({ ok: true, handled: false });
  }

  try {
    await dispatchHandler(event, organizationId);
    await db
      .update(paymentEvents)
      .set({ handlerStatus: "ok", processedAt: new Date() })
      .where(eq(paymentEvents.stripeEventId, event.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[stripe-webhook]", "handler failed", {
      eventId: event.id,
      eventType: event.type,
      error: message,
    });
    await db
      .update(paymentEvents)
      .set({
        handlerStatus: "failed",
        handlerError: message.slice(0, 2000),
        processedAt: new Date(),
      })
      .where(eq(paymentEvents.stripeEventId, event.id));
    // Still ack 200 — the failure is preserved in payment_event for
    // operator replay via the Slice 4 admin UI. Returning 500 would
    // cause Stripe to retry for ~3 days, piling up behind the broken
    // handler. See header comment.
  }

  return NextResponse.json({ ok: true, handled: true });
}

/**
 * Extract the Stripe customer id from an event's data payload, falling
 * back to subscription.customer for events that don't carry it at the
 * top level. Returns null when the event isn't customer-scoped.
 */
function extractStripeCustomerId(event: Stripe.Event): string | null {
  const obj = event.data.object as unknown as Record<string, unknown>;
  const direct = obj["customer"];
  if (typeof direct === "string") return direct;
  // Stripe expands `customer` to a full object on some events — pull
  // the id when that happens.
  if (
    direct &&
    typeof direct === "object" &&
    "id" in direct &&
    typeof (direct as { id: unknown }).id === "string"
  ) {
    return (direct as { id: string }).id;
  }
  return null;
}

/**
 * Per-event-type dispatcher. Each branch is intentionally small —
 * pulls the minimum fields from the event and writes to
 * `tenant_subscription`. Tier-id resolution (matching Stripe price ids
 * to FORGE subscription_tier rows) lands in Slice 3 when we wire the
 * Stripe Product/Price → tier mapping. For Slice 2 the handlers
 * record the binding but don't yet flip the tier.
 */
async function dispatchHandler(
  event: Stripe.Event,
  organizationId: string | null,
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(
        event.data.object as Stripe.Checkout.Session,
        organizationId,
      );
      break;
    case "customer.subscription.updated":
      await handleSubscriptionUpdated(
        event.data.object as Stripe.Subscription,
        organizationId,
      );
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(
        event.data.object as Stripe.Subscription,
        organizationId,
      );
      break;
    case "invoice.paid":
    case "invoice.payment_failed":
      // Slice 2 records these in the event ledger. Slice 4 wires the
      // dunning email sequence on payment_failed.
      break;
  }
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  organizationId: string | null,
): Promise<void> {
  // The session's `client_reference_id` is the organizationId we set
  // when creating the Checkout (Slice 3 wires this). Without it we
  // can't bind the new Stripe customer to a FORGE tenant.
  const orgFromSession =
    typeof session.client_reference_id === "string"
      ? session.client_reference_id
      : null;
  const resolvedOrgId = organizationId ?? orgFromSession;
  if (!resolvedOrgId) {
    throw new Error(
      "checkout.session.completed missing client_reference_id and no tenant matches the Stripe customer",
    );
  }
  const customerId =
    typeof session.customer === "string" ? session.customer : null;
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : null;
  if (!customerId) {
    throw new Error("checkout.session.completed without a customer id");
  }

  await db
    .update(tenantSubscriptions)
    .set({
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId ?? null,
      status: "active",
      updatedAt: new Date(),
    })
    .where(eq(tenantSubscriptions.organizationId, resolvedOrgId));

  await recordAudit({
    organizationId: resolvedOrgId,
    actor: { userId: null, email: "stripe-webhook" },
    action: "subscription.checkout_completed",
    resourceType: "tenant_subscription",
    resourceId: resolvedOrgId,
    metadata: {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      sessionId: session.id,
    },
  });
}

async function handleSubscriptionUpdated(
  sub: Stripe.Subscription,
  organizationId: string | null,
): Promise<void> {
  if (!organizationId) {
    throw new Error(
      `customer.subscription.updated for unknown customer ${sub.customer as string}`,
    );
  }
  await db
    .update(tenantSubscriptions)
    .set({
      stripeSubscriptionId: sub.id,
      status: mapStripeStatus(sub.status),
      currentPeriodStart: sub.current_period_start
        ? new Date(sub.current_period_start * 1000)
        : null,
      currentPeriodEnd: sub.current_period_end
        ? new Date(sub.current_period_end * 1000)
        : null,
      cancelAt: sub.cancel_at ? new Date(sub.cancel_at * 1000) : null,
      updatedAt: new Date(),
    })
    .where(eq(tenantSubscriptions.organizationId, organizationId));

  await recordAudit({
    organizationId,
    actor: { userId: null, email: "stripe-webhook" },
    action: "subscription.updated",
    resourceType: "tenant_subscription",
    resourceId: organizationId,
    metadata: {
      stripeSubscriptionId: sub.id,
      stripeStatus: sub.status,
    },
  });
}

async function handleSubscriptionDeleted(
  sub: Stripe.Subscription,
  organizationId: string | null,
): Promise<void> {
  if (!organizationId) {
    throw new Error(
      `customer.subscription.deleted for unknown customer ${sub.customer as string}`,
    );
  }
  await db
    .update(tenantSubscriptions)
    .set({
      status: "canceled",
      stripeSubscriptionId: null,
      cancelAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tenantSubscriptions.organizationId, organizationId));

  await recordAudit({
    organizationId,
    actor: { userId: null, email: "stripe-webhook" },
    action: "subscription.cancelled",
    resourceType: "tenant_subscription",
    resourceId: organizationId,
    metadata: { stripeSubscriptionId: sub.id },
  });
}

/**
 * Stripe subscription status → FORGE `tenant_subscription.status`
 * enum. We collapse Stripe's richer set into our smaller one — paused
 * / trialing / past_due all map onto our coarser states.
 */
function mapStripeStatus(
  status: Stripe.Subscription.Status,
): "active" | "trial" | "past_due" | "canceled" | "paused" {
  switch (status) {
    case "active":
      return "active";
    case "trialing":
      return "trial";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    case "paused":
      return "paused";
    case "incomplete":
    default:
      return "active";
  }
}
