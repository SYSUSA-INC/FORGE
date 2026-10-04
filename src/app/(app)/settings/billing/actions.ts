"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import type Stripe from "stripe";
import { db } from "@/db";
import {
  organizations,
  subscriptionTiers,
  tenantSubscriptions,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg, requireOrgAdmin } from "@/lib/auth-helpers";
import { endGrantNow, getAddonBySlug, getTenantGrant, listAddonCatalog, provisionStripeAddon, setGrantQuantity, type AddonCatalogRow } from "@/lib/addons";
import { ADDON_LIMITS, canBillOnPlan, sanitizeAddonQuantity, splitSubscriptionItems } from "@/lib/addons-logic";
import { getStripeClient } from "@/lib/stripe";
import { recordAudit } from "@/lib/audit-log";
import { log } from "@/lib/log";

export type CheckoutSessionResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/** An add-on purchase either needs Checkout (url) or was added to the plan's subscription (url null). */
export type AddonPurchaseResult =
  | { ok: true; url: string }
  | { ok: true; url: null; message: string }
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
 * BL-PACKAGES add-ons Slice 2a — one invoice. When the tenant already
 * pays for a plan by card and the add-on's Price recurs on the plan's
 * interval, the add-on becomes an item on the plan's own subscription
 * (prorated for the rest of the period, then on the same invoice). A
 * second purchase of a top-up raises the item's quantity. Returns null
 * when the add-on can't ride on the plan, so the caller falls back to a
 * separate checkout.
 */
async function addToPlanSubscription(input: {
  stripe: Stripe;
  organizationId: string;
  actor: { id: string; email?: string | null };
  addon: AddonCatalogRow;
  quantity: number;
  planSubscriptionId: string;
}): Promise<AddonPurchaseResult | null> {
  const { stripe, organizationId, addon } = input;
  let plan: Stripe.Subscription;
  let addonPrice: Stripe.Price;
  try {
    [plan, addonPrice] = await Promise.all([
      stripe.subscriptions.retrieve(input.planSubscriptionId),
      stripe.prices.retrieve(addon.stripePriceId!),
    ]);
  } catch (err) {
    log.warn("[addToPlanSubscription]", "could not read the plan subscription; using a separate checkout", {
      organizationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  const catalog = await listAddonCatalog();
  const addonPrices = new Set(catalog.map((a) => a.stripePriceId).filter((p): p is string => !!p));
  const items = plan.items.data.map((i) => ({
    id: i.id,
    priceId: i.price?.id ?? null,
    quantity: i.quantity ?? null,
    interval: i.price?.recurring?.interval ?? null,
  }));
  const { planItem } = splitSubscriptionItems(items, addonPrices);
  if (!canBillOnPlan({ planStatus: plan.status, planInterval: planItem?.interval ?? null, addonInterval: addonPrice.recurring?.interval ?? null })) {
    return null;
  }

  const existing = items.find((i) => i.priceId === addon.stripePriceId);
  if (existing && addon.kind !== "ai_tokens") return { ok: false, error: `You already have ${addon.name}.` };
  try {
    const total = existing ? Math.min(ADDON_LIMITS.quantity.max, (existing.quantity ?? 1) + input.quantity) : input.quantity;
    const item = existing
      ? await stripe.subscriptionItems.update(existing.id, { quantity: total, proration_behavior: "create_prorations" })
      : await stripe.subscriptionItems.create({
          subscription: plan.id,
          price: addon.stripePriceId!,
          quantity: total,
          proration_behavior: "create_prorations",
          metadata: { organizationId, forgeAddonSlug: addon.slug },
        });
    const res = await provisionStripeAddon({
      organizationId,
      addonSlug: addon.slug,
      quantity: total,
      stripeSubscriptionId: plan.id,
      stripeSubscriptionItemId: item.id,
      note: "Billed on the plan's subscription.",
    });
    if (!res.ok) return { ok: false, error: res.error };
    await recordAudit({
      organizationId,
      actor: { userId: input.actor.id, email: input.actor.email },
      action: "subscription.addon_added_to_plan",
      resourceType: "tenant_addon",
      resourceId: res.id,
      metadata: { addonSlug: addon.slug, quantity: total, stripeSubscriptionItemId: item.id },
    });
    revalidatePath("/settings/billing");
    return {
      ok: true,
      url: null,
      message: `${addon.name} is on your plan now. Your next invoice includes it, prorated for the rest of this period.`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[addToPlanSubscription]", "stripe item change failed", { organizationId, addonSlug: addon.slug, error: message });
    return { ok: false, error: `Could not add it to your plan: ${message.slice(0, 200)}` };
  }
}

/**
 * BL-PACKAGES add-ons — buy an add-on for the current tenant.
 *
 * Slice 2a: on a card-paid plan whose interval matches, the add-on is
 * added to the plan's own subscription (one invoice, prorated). Else a
 * separate recurring Stripe subscription per add-on (quantity for
 * token top-ups) through Checkout, so cancelling one never touches the
 * plan; the session and the subscription carry our metadata and the
 * webhook reads `forgeAddonSlug` to record the grant. Org admins only.
 */
export async function createAddonCheckoutSessionAction(input: {
  addonSlug: string;
  quantity: number;
}): Promise<AddonPurchaseResult> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const addon = await getAddonBySlug(input.addonSlug);
  if (!addon || !addon.active) {
    return { ok: false, error: "That add-on is no longer available." };
  }
  if (!addon.stripePriceId) {
    return {
      ok: false,
      error: `"${addon.name}" isn't available for self-serve checkout. Contact sales@sysgov.com.`,
    };
  }
  const quantity = addon.kind === "ai_tokens" ? sanitizeAddonQuantity(input.quantity) : 1;
  if (quantity === null) {
    return { ok: false, error: "Quantity: a whole number from 1 to 100." };
  }

  const [orgRow] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!orgRow) {
    return { ok: false, error: "Could not load your organization." };
  }
  const [subRow] = await db
    .select({
      stripeCustomerId: tenantSubscriptions.stripeCustomerId,
      stripeSubscriptionId: tenantSubscriptions.stripeSubscriptionId,
    })
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.organizationId, organizationId))
    .limit(1);

  let stripe;
  try {
    stripe = getStripeClient();
  } catch (err) {
    log.error("[createAddonCheckoutSessionAction]", "stripe client unavailable", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      error:
        "Checkout is not configured for this environment. Contact support if this is unexpected.",
    };
  }

  if (subRow?.stripeSubscriptionId) {
    const onPlan = await addToPlanSubscription({
      stripe,
      organizationId,
      actor,
      addon,
      quantity,
      planSubscriptionId: subRow.stripeSubscriptionId,
    });
    if (onPlan) return onPlan;
  }

  const appUrl = (
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://app.forge.app"
  ).replace(/\/$/, "");
  const metadata = {
    organizationId,
    organizationName: orgRow.name,
    kind: "addon",
    addonSlug: addon.slug,
    quantity: String(quantity),
  };

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ...(subRow?.stripeCustomerId
        ? { customer: subRow.stripeCustomerId }
        : {
            customer_email: actor.email ?? undefined,
            customer_creation: "always" as const,
          }),
      client_reference_id: organizationId,
      line_items: [{ price: addon.stripePriceId, quantity }],
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      success_url: `${appUrl}/settings/billing?checkout=addon-success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/settings/billing?checkout=cancelled`,
      metadata,
      // The subscription itself carries the slug, so lifecycle events
      // (updated / deleted) are recognised as this add-on's.
      subscription_data: { metadata: { organizationId, forgeAddonSlug: addon.slug } },
    });
    if (!session.url) {
      return { ok: false, error: "Stripe didn't return a checkout URL — try again." };
    }
    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "subscription.addon_checkout_started",
      resourceType: "tenant_addon",
      resourceId: addon.id,
      metadata: { addonSlug: addon.slug, quantity, sessionId: session.id },
    });
    return { ok: true, url: session.url };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[createAddonCheckoutSessionAction]", "stripe session create failed", {
      organizationId,
      addonSlug: addon.slug,
      error: message,
    });
    return { ok: false, error: `Could not start checkout: ${message.slice(0, 200)}` };
  }
}

/**
 * BL-PACKAGES add-ons Slice 2a — change how many of a card-bought token
 * top-up the tenant has. Stripe prorates the difference onto the next
 * invoice; the grant follows at once (and the webhook confirms it).
 */
export async function changeAddonQuantityAction(input: {
  tenantAddonId: string;
  quantity: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const quantity = sanitizeAddonQuantity(input.quantity);
  if (quantity === null) return { ok: false, error: `Quantity: a whole number from ${ADDON_LIMITS.quantity.min} to ${ADDON_LIMITS.quantity.max}.` };
  const grant = await getTenantGrant({ organizationId, tenantAddonId: input.tenantAddonId });
  if (!grant || grant.status !== "active") return { ok: false, error: "That add-on is no longer active." };
  if (grant.source !== "stripe") return { ok: false, error: "This add-on was granted by FORGE — contact us to change it." };
  if (grant.kind !== "ai_tokens") return { ok: false, error: "Only token top-ups have a quantity." };
  if (quantity === grant.quantity) return { ok: true };

  try {
    const stripe = getStripeClient();
    let itemId = grant.stripeSubscriptionItemId;
    if (!itemId && grant.stripeSubscriptionId) {
      const sub = await stripe.subscriptions.retrieve(grant.stripeSubscriptionId);
      itemId = sub.items.data[0]?.id ?? null;
    }
    if (!itemId) return { ok: false, error: "Could not find this add-on in Stripe. Use the billing portal." };
    await stripe.subscriptionItems.update(itemId, { quantity, proration_behavior: "create_prorations" });
    await setGrantQuantity({
      organizationId,
      tenantAddonId: grant.id,
      quantity,
      actor: { userId: actor.id, email: actor.email },
      stripeSubscriptionItemId: itemId,
    });
    revalidatePath("/settings/billing");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[changeAddonQuantityAction]", "stripe quantity change failed", { organizationId, error: message });
    return { ok: false, error: `Could not change the quantity: ${message.slice(0, 200)}` };
  }
}

/**
 * BL-PACKAGES add-ons Slice 2a — remove a card-bought add-on. One billed
 * on the plan's subscription is removed now and the unused time is
 * credited on the next invoice; one with its own subscription is
 * cancelled at the end of the period already paid for.
 */
export async function removeAddonAction(
  tenantAddonId: string,
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const grant = await getTenantGrant({ organizationId, tenantAddonId });
  if (!grant || grant.status !== "active") return { ok: false, error: "That add-on is no longer active." };
  if (grant.source !== "stripe" || !grant.stripeSubscriptionId) {
    return { ok: false, error: "This add-on was granted by FORGE — contact us to remove it." };
  }
  const [subRow] = await db
    .select({ stripeSubscriptionId: tenantSubscriptions.stripeSubscriptionId })
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.organizationId, organizationId))
    .limit(1);
  const onPlan = !!grant.stripeSubscriptionItemId && grant.stripeSubscriptionId === subRow?.stripeSubscriptionId;

  try {
    const stripe = getStripeClient();
    if (onPlan) {
      await stripe.subscriptionItems.del(grant.stripeSubscriptionItemId!, { proration_behavior: "create_prorations" });
      await endGrantNow({ organizationId, tenantAddonId: grant.id, actor: { userId: actor.id, email: actor.email } });
      revalidatePath("/settings/billing");
      return { ok: true, message: "Removed. The unused part of this period is credited on your next invoice." };
    }
    await stripe.subscriptions.update(grant.stripeSubscriptionId, { cancel_at_period_end: true });
    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "tenant.addon.cancel_requested",
      resourceType: "tenant_addon",
      resourceId: grant.id,
      metadata: { stripeSubscriptionId: grant.stripeSubscriptionId },
    });
    revalidatePath("/settings/billing");
    return { ok: true, message: "Cancelled. It stays on until the end of the period you have paid for." };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[removeAddonAction]", "stripe removal failed", { organizationId, error: message });
    return { ok: false, error: `Could not remove it: ${message.slice(0, 200)}` };
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
