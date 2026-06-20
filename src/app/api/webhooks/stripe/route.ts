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
import { resolveTierFromStripePriceId } from "@/lib/stripe-tier-resolve";
import { sendPaymentFailedEmail } from "@/lib/stripe-dunning-email";
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
      // Slice 2 already records this in the event ledger. The
      // subscription.updated event fires alongside paid invoices and
      // handles tier/period bookkeeping, so no work needed here.
      break;
    case "invoice.payment_failed":
      // BL-17 Slice 4 — single notification email. Stripe Smart
      // Retries owns the retry timing; subsequent payment_failed
      // events for the same invoice are deduped by the email helper.
      await handleInvoicePaymentFailed(
        event.data.object as Stripe.Invoice,
        organizationId,
      );
      break;
  }
}

async function handleInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  organizationId: string | null,
): Promise<void> {
  if (!organizationId) {
    log.warn(
      "[stripe-webhook]",
      "invoice.payment_failed for unknown customer — skipping email",
      { invoiceId: invoice.id, customer: invoice.customer },
    );
    return;
  }
  await sendPaymentFailedEmail({
    organizationId,
    invoiceId: invoice.id,
    amountDueCents: invoice.amount_due ?? 0,
    currency: invoice.currency ?? "usd",
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    attemptCount: invoice.attempt_count ?? 1,
    nextPaymentAttemptAt: invoice.next_payment_attempt
      ? new Date(invoice.next_payment_attempt * 1000)
      : null,
  });
  await recordAudit({
    organizationId,
    actor: { userId: null, email: "stripe-webhook" },
    action: "subscription.payment_failed",
    resourceType: "tenant_subscription",
    resourceId: organizationId,
    metadata: {
      invoiceId: invoice.id,
      amountDueCents: invoice.amount_due,
      attemptCount: invoice.attempt_count,
    },
  });
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

  // BL-17 Slice 4 — resolve tier_id from the Stripe Price the customer
  // checked out with. Stripe Checkout sessions don't carry line items
  // on the event payload by default; expand or list separately.
  let resolvedTierId: string | null = null;
  try {
    const stripe = getStripeClient();
    const items = await stripe.checkout.sessions.listLineItems(session.id, {
      limit: 1,
    });
    const priceId = items.data[0]?.price?.id ?? null;
    if (priceId) {
      const tier = await resolveTierFromStripePriceId(priceId);
      if (tier) resolvedTierId = tier.tierId;
    }
  } catch (err) {
    log.warn("[stripe-webhook]", "could not resolve tier from line items", {
      sessionId: session.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await db
    .update(tenantSubscriptions)
    .set({
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId ?? null,
      ...(resolvedTierId ? { tierId: resolvedTierId } : {}),
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
      tierId: resolvedTierId,
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

  // BL-17 Slice 4 — when the customer changes plan via the Stripe
  // Customer Portal, this event fires with the new Price id on the
  // first subscription item. Re-resolve the FORGE tier so our
  // tenant_subscription row reflects the change.
  const priceId = sub.items.data[0]?.price?.id ?? null;
  let resolvedTierId: string | null = null;
  if (priceId) {
    const tier = await resolveTierFromStripePriceId(priceId);
    if (tier) resolvedTierId = tier.tierId;
  }

  await db
    .update(tenantSubscriptions)
    .set({
      stripeSubscriptionId: sub.id,
      ...(resolvedTierId ? { tierId: resolvedTierId } : {}),
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
      tierId: resolvedTierId,
      stripePriceId: priceId,
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
