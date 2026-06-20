"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  organizations,
  subscriptionTiers,
  tenantSubscriptions,
} from "@/db/schema";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { getStripeClient } from "@/lib/stripe";
import { recordAudit } from "@/lib/audit-log";
import { log } from "@/lib/log";

/**
 * BL-17 Slice 5 — issue an enterprise wire-invoice for a tenant.
 *
 * Sales-led path: superadmin clicks this from /admin/orgs/[id] after
 * a verbal deal is closed off-platform. Creates the Stripe Customer
 * (if missing) + Subscription with `collection_method: 'send_invoice'`
 * + Net-30 terms. Stripe sends the customer a hosted invoice page
 * with a virtual US bank account number; customer's AP wires the
 * money; Stripe reconciles; `invoice.paid` webhook fires; existing
 * handlers from Slices 2-4 flip tier_id and set status=active.
 *
 * Why a separate action from createCheckoutSessionAction:
 *   - Different gate: enterprise invoicing is superadmin-only
 *     (sales-assisted), not org-admin (self-serve)
 *   - Different Stripe API: invoice creation, not Checkout Session
 *   - Different payment method: us_bank_transfer / wire, not card
 *   - Different metadata: PO number, finance contact email, custom
 *     billing entity name
 *
 * Caller is responsible for resolving the customer's billing email
 * (often AP@<customer-domain>, not the FORGE user's email).
 */

export type IssueEnterpriseInvoiceResult =
  | {
      ok: true;
      invoiceId: string;
      hostedInvoiceUrl: string | null;
      subscriptionId: string;
    }
  | { ok: false; error: string };

export async function issueEnterpriseInvoiceAction(input: {
  organizationId: string;
  tierSlug: string;
  period: "monthly" | "yearly";
  billingEmail: string;
  poNumber: string;
  daysUntilDue: number;
  notes: string;
}): Promise<IssueEnterpriseInvoiceResult> {
  const actor = await requireSuperadmin();

  // Validate input shape early — return user-friendly errors instead
  // of a Stripe API rejection downstream.
  const billingEmail = input.billingEmail.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingEmail)) {
    return { ok: false, error: "Billing email is not a valid email address." };
  }
  const poNumber = input.poNumber.trim();
  if (poNumber.length === 0) {
    return { ok: false, error: "PO number is required for enterprise invoices." };
  }
  const daysUntilDue =
    Number.isFinite(input.daysUntilDue) && input.daysUntilDue > 0
      ? Math.min(120, Math.floor(input.daysUntilDue))
      : 30;

  // Resolve tier + Stripe Price.
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
    return { ok: false, error: `Unknown tier: ${input.tierSlug}` };
  }
  if (!tier.active) {
    return { ok: false, error: `Tier "${tier.name}" is retired; pick an active tier.` };
  }
  const priceId =
    input.period === "yearly" ? tier.stripePriceIdYearly : tier.stripePriceIdMonthly;
  if (!priceId) {
    return {
      ok: false,
      error: `No Stripe Price configured for ${tier.name} (${input.period}). Paste the Price id in /admin/tiers first.`,
    };
  }

  // Resolve tenant + Stripe Customer state.
  const [org] = await db
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  if (!org) {
    return { ok: false, error: "Tenant not found." };
  }
  const [sub] = await db
    .select({
      stripeCustomerId: tenantSubscriptions.stripeCustomerId,
      stripeSubscriptionId: tenantSubscriptions.stripeSubscriptionId,
    })
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.organizationId, input.organizationId))
    .limit(1);

  let stripe;
  try {
    stripe = getStripeClient();
  } catch (err) {
    log.error("[issueEnterpriseInvoiceAction]", "stripe client unavailable", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      error:
        "Stripe isn't configured for this environment. Contact engineering.",
    };
  }

  // Create or reuse the Stripe Customer.
  let customerId = sub?.stripeCustomerId ?? null;
  try {
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: billingEmail,
        name: org.name,
        metadata: { organizationId: org.id, organizationSlug: org.id },
      });
      customerId = customer.id;
      // Persist immediately so a partial failure doesn't leave us
      // orphaning Stripe customers across retries.
      await db
        .update(tenantSubscriptions)
        .set({ stripeCustomerId: customerId, updatedAt: new Date() })
        .where(eq(tenantSubscriptions.organizationId, org.id));
    } else {
      // Update billing email on the existing customer so the invoice
      // goes to AP, not whoever first used the org self-serve.
      await stripe.customers.update(customerId, { email: billingEmail });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[issueEnterpriseInvoiceAction]", "customer create/update failed", {
      organizationId: org.id,
      error: message,
    });
    return {
      ok: false,
      error: `Could not create Stripe customer: ${message.slice(0, 200)}`,
    };
  }

  // Create the subscription with send_invoice collection. Stripe
  // generates the first invoice synchronously when the subscription is
  // created; we wait for it and return its hosted URL.
  try {
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      collection_method: "send_invoice",
      days_until_due: daysUntilDue,
      // Enable customer_balance + bank-transfer payment methods so AP
      // can wire to a virtual US bank account number.
      payment_settings: {
        payment_method_types: ["customer_balance"],
        payment_method_options: {
          customer_balance: {
            funding_type: "bank_transfer",
            bank_transfer: { type: "us_bank_transfer" },
          },
        },
      },
      metadata: {
        organizationId: org.id,
        organizationName: org.name,
        tierSlug: tier.slug,
        period: input.period,
        poNumber,
        salesNotes: input.notes.slice(0, 500),
      },
      // Expand the latest invoice so we can return its hosted URL.
      expand: ["latest_invoice"],
    });

    const invoice =
      typeof subscription.latest_invoice === "object" && subscription.latest_invoice
        ? subscription.latest_invoice
        : null;

    if (invoice) {
      // Add PO# metadata to the invoice itself (separate from the
      // subscription) so it appears on the hosted invoice page +
      // PDF, which is what the customer's AP sees.
      try {
        await stripe.invoices.update(invoice.id, {
          metadata: { poNumber, organizationId: org.id },
        });
      } catch (err) {
        // Non-fatal — the subscription's metadata still carries PO#.
        log.warn(
          "[issueEnterpriseInvoiceAction]",
          "invoice metadata update failed (PO# is still on subscription)",
          { error: err instanceof Error ? err.message : String(err) },
        );
      }
    }

    // Record bookkeeping on our tenant_subscription row.
    await db
      .update(tenantSubscriptions)
      .set({
        stripeSubscriptionId: subscription.id,
        // Status stays at its previous value — the existing webhook
        // will flip to active once the wire is received.
        updatedAt: new Date(),
      })
      .where(eq(tenantSubscriptions.organizationId, org.id));

    await recordAudit({
      organizationId: org.id,
      actor: { userId: actor.id, email: actor.email },
      action: "subscription.enterprise_invoice_issued",
      resourceType: "tenant_subscription",
      resourceId: org.id,
      metadata: {
        tierSlug: tier.slug,
        period: input.period,
        billingEmail,
        poNumber,
        daysUntilDue,
        subscriptionId: subscription.id,
        invoiceId: invoice?.id ?? null,
      },
    });

    return {
      ok: true,
      invoiceId: invoice?.id ?? "",
      hostedInvoiceUrl: invoice?.hosted_invoice_url ?? null,
      subscriptionId: subscription.id,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("[issueEnterpriseInvoiceAction]", "subscription create failed", {
      organizationId: org.id,
      tierSlug: tier.slug,
      error: message,
    });
    return {
      ok: false,
      error: `Could not issue enterprise invoice: ${message.slice(0, 200)}`,
    };
  }
}
