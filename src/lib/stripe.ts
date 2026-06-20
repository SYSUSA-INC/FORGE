import "server-only";

import Stripe from "stripe";

/**
 * BL-17 Slice 2 — singleton Stripe client.
 *
 * Webhook signature verification + future Checkout/Customer Portal
 * calls flow through this client. We pin the API version so a Stripe
 * dashboard "Update API version" click can't quietly break our code.
 *
 * Lazy-instantiated: many routes import this module without ever
 * touching Stripe (e.g. in environments where STRIPE_SECRET_KEY isn't
 * configured yet — staging before the operator finishes account
 * setup). Throwing on import would break those deploys. Throwing on
 * first call surfaces the misconfig to the actual feature that needs
 * Stripe instead.
 *
 * Set in Vercel env (per ADR § 8):
 *   STRIPE_SECRET_KEY        — sk_live_... (prod) or sk_test_... (staging)
 *   STRIPE_WEBHOOK_SECRET    — whsec_... from the Stripe webhook config
 */

const PINNED_API_VERSION = "2025-02-24.acacia" as const;

let cachedClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (cachedClient) return cachedClient;
  const key = (process.env.STRIPE_SECRET_KEY || "").trim();
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not configured. Set it in the Vercel env per docs/architecture/adr-001-payment-provider.md § 8.",
    );
  }
  cachedClient = new Stripe(key, {
    apiVersion: PINNED_API_VERSION,
    // Reasonable default — fail fast rather than hang an entire
    // request waiting on Stripe. Webhook routes have their own
    // request-level timeout via Next.js.
    timeout: 10_000,
    maxNetworkRetries: 2,
  });
  return cachedClient;
}

export function getWebhookSecret(): string {
  const secret = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!secret) {
    throw new Error(
      "STRIPE_WEBHOOK_SECRET is not configured. Get it from Stripe Dashboard → Webhooks → endpoint → Signing secret.",
    );
  }
  return secret;
}

/**
 * BL-17 — Stripe events we handle today. Anything else is recorded in
 * `payment_event` with handler_status='unhandled' for visibility, but
 * we don't act on it. Add to this list as new flows ship in later
 * slices (e.g. `customer.subscription.trial_will_end` for Slice 4
 * dunning emails).
 */
export const HANDLED_EVENT_TYPES = new Set<string>([
  // Slice 2 — initial subscription provisioning
  "checkout.session.completed",
  // Subscription lifecycle
  "customer.subscription.updated",
  "customer.subscription.deleted",
  // Invoicing — settled and failed
  "invoice.paid",
  "invoice.payment_failed",
]);
