"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  organizations,
  subscriptionTiers,
  tenantSubscriptions,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg, requireOrgAdmin } from "@/lib/auth-helpers";
import { getStripeClient } from "@/lib/stripe";
import { recordAudit } from "@/lib/audit-log";
import { log } from "@/lib/log";

export type CheckoutSessionResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * BL-17 Slice 3 — create a Stripe Checkout Session for the current tenant.
 *
 * Flow:
 *   1. Auth + tenant resolution. Only org admins (or superadmins) may
 *      initiate billing changes — same posture as tier-edit on
 *      `/admin/tiers`.
 *   2. Look up the chosen tier + its Stripe Price for the requested
 *      billing period (monthly / yearly). Refuse if the tier has no
 *      Stripe Price configured (Enterprise tiers go through
 *      sales-assisted invoicing — BL-17 Slice 5).
 *   3. Resolve or create the Stripe Customer for this tenant.
 *      First-time checkout creates a new Customer; subsequent
 *      upgrades reuse the existing one (looked up via
 *      tenant_subscription.stripe_customer_id).
 *   4. Create the Checkout Session with `client_reference_id` set
 *      to the FORGE organizationId. The webhook (Slice 2) uses this
 *      to bind the resulting Stripe Customer + Subscription back to
 *      the right tenant.
 *   5. Return the hosted Checkout URL — the caller redirects.
 *
 * Why `mode: 'subscription'`: every FORGE tier is recurring. One-time
 * SKUs (e.g. add-on credits) are out of scope until a customer asks.
 */
export async function createCheckoutSessionAction(input: {
  tierSlug: string;
  period: "monthly" | "yearly";
}): Promise<CheckoutSessionResult> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  // 1. Tier + Stripe Price lookup.
  const [tier] = await db
    .select({
      id: subscriptionTiers.id,
      name: subscriptionTiers.name,
      slug: subscriptionTiers.slug,
      stripePriceIdMonthly: subscriptionTiers.stripePriceIdMonthly,
      stripePriceIdYearly: subscriptionTiers.stripePriceIdYearly,
      active: subscriptionTiers.active,
    })
    .from(subscriptionTiers)
    .where(eq(subscriptionTiers.slug, input.tierSlug))
    .limit(1);

  if (!tier) {
    return { ok: false, error: `Unknown plan: ${input.tierSlug}` };
  }
  if (!tier.active) {
    return { ok: false, error: `Plan "${tier.name}" is no longer available.` };
  }
  const priceId =
    input.period === "yearly" ? tier.stripePriceIdYearly : tier.stripePriceIdMonthly;
  if (!priceId) {
    return {
      ok: false,
      error: `The "${tier.name}" plan isn't available for self-serve checkout. Contact sales@sysgov.com for a quote.`,
    };
  }

  // 2. Resolve org + current Stripe customer (if any) + org email.
  const [orgRow] = await db
    .select({
      name: organizations.name,
      slug: organizations.slug,
    })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!orgRow) {
    return { ok: false, error: "Could not load your organization." };
  }

  const [subRow] = await db
    .select({ stripeCustomerId: tenantSubscriptions.stripeCustomerId })
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.organizationId, organizationId))
    .limit(1);

  // 3. Build the Checkout Session.
  let stripe;
  try {
    stripe = getStripeClient();
  } catch (err) {
    log.error("[createCheckoutSessionAction]", "stripe client unavailable", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      error:
        "Checkout is not configured for this environment. Contact support if this is unexpected.",
    };
  }

  const appUrl = (
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://app.forge.app"
  ).replace(/\/$/, "");
  const successUrl = `${appUrl}/settings/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${appUrl}/pricing?checkout=cancelled`;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      // Pre-fill the customer when we already have one (upgrade path).
      // Otherwise let Stripe create a new customer; the webhook will
      // bind it via `client_reference_id`.
      ...(subRow?.stripeCustomerId
        ? { customer: subRow.stripeCustomerId }
        : {
            customer_email: actor.email ?? undefined,
            customer_creation: "always" as const,
          }),
      client_reference_id: organizationId,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      // Allow promotion codes — the input box on Stripe Checkout's
      // hosted page. Codes themselves are managed in Stripe Dashboard
      // (separate from our `promo_code` table; Slice 4 can layer
      // FORGE-side promo redemption on top if needed).
      allow_promotion_codes: true,
      // Per Stripe docs: billing_address_collection auto for global
      // tax handling. We're not registered for VAT yet but this gives
      // Stripe Tax the data it needs once we are.
      billing_address_collection: "auto",
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        organizationId,
        organizationName: orgRow.name,
        tierSlug: tier.slug,
        period: input.period,
      },
    });

    if (!session.url) {
      return {
        ok: false,
        error: "Stripe didn't return a checkout URL — try again.",
      };
    }

    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "subscription.checkout_started",
      resourceType: "tenant_subscription",
      resourceId: organizationId,
      metadata: {
        tierSlug: tier.slug,
        period: input.period,
        sessionId: session.id,
      },
    });

    return { ok: true, url: session.url };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[createCheckoutSessionAction]", "stripe session create failed", {
      organizationId,
      tierSlug: tier.slug,
      error: message,
    });
    return {
      ok: false,
      error: `Could not start checkout: ${message.slice(0, 200)}`,
    };
  }
}

/**
 * BL-17 Slice 4 — open the Stripe Customer Portal for the current tenant.
 *
 * Stripe-hosted self-service: update payment method, change plan,
 * download invoices, cancel subscription. Returns a one-time URL the
 * caller redirects to.
 *
 * Requires an existing Stripe Customer (i.e. the tenant has gone
 * through Checkout at least once). For tenants that haven't yet,
 * surface an error directing them to the upgrade flow instead.
 *
 * Gated by `requireOrgAdmin` — same posture as
 * `createCheckoutSessionAction`. Non-admins see the page but can't
 * open the portal.
 */
export async function createPortalSessionAction(): Promise<CheckoutSessionResult> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const [subRow] = await db
    .select({ stripeCustomerId: tenantSubscriptions.stripeCustomerId })
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.organizationId, organizationId))
    .limit(1);
  if (!subRow?.stripeCustomerId) {
    return {
      ok: false,
      error:
        "No Stripe billing account is linked yet. Pick a plan above to set one up.",
    };
  }

  let stripe;
  try {
    stripe = getStripeClient();
  } catch (err) {
    log.error("[createPortalSessionAction]", "stripe client unavailable", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      error:
        "Billing portal isn't configured for this environment. Contact support.",
    };
  }

  const appUrl = (
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://app.forge.app"
  ).replace(/\/$/, "");

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: subRow.stripeCustomerId,
      return_url: `${appUrl}/settings/billing`,
    });
    if (!session.url) {
      return {
        ok: false,
        error: "Stripe didn't return a portal URL — try again.",
      };
    }
    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "subscription.portal_opened",
      resourceType: "tenant_subscription",
      resourceId: organizationId,
      metadata: { sessionId: session.id },
    });
    return { ok: true, url: session.url };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[createPortalSessionAction]", "stripe portal create failed", {
      organizationId,
      error: message,
    });
    return {
      ok: false,
      error: `Could not open billing portal: ${message.slice(0, 200)}`,
    };
  }
}

/**
 * Server-side check for "this tenant has any active paid subscription."
 * Used by the billing page header to decide between an "Upgrade" and
 * a "Start a paid plan" framing.
 */
export async function getBillingSummary(): Promise<{
  organizationId: string;
  currentTierSlug: string | null;
  currentTierName: string | null;
  hasStripeCustomer: boolean;
  status: string | null;
  currentPeriodEnd: string | null;
}> {
  const { organizationId } = await requireCurrentOrg();
  const [row] = await db
    .select({
      tierSlug: subscriptionTiers.slug,
      tierName: subscriptionTiers.name,
      stripeCustomerId: tenantSubscriptions.stripeCustomerId,
      status: tenantSubscriptions.status,
      currentPeriodEnd: tenantSubscriptions.currentPeriodEnd,
    })
    .from(tenantSubscriptions)
    .leftJoin(
      subscriptionTiers,
      eq(subscriptionTiers.id, tenantSubscriptions.tierId),
    )
    .where(eq(tenantSubscriptions.organizationId, organizationId))
    .limit(1);

  return {
    organizationId,
    currentTierSlug: row?.tierSlug ?? null,
    currentTierName: row?.tierName ?? null,
    hasStripeCustomer: !!row?.stripeCustomerId,
    status: row?.status ?? null,
    currentPeriodEnd: row?.currentPeriodEnd?.toISOString() ?? null,
  };
}
