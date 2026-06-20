-- BL-17 Slice 2 — Stripe payment-provider columns + webhook event ledger.
--
-- We're adopting Stripe per docs/architecture/adr-001-payment-provider.md.
-- This migration adds the two minimal columns to bind a tenant
-- subscription to its Stripe counterparts, plus a payment_event
-- table that serves three purposes:
--
--   1. WEBHOOK IDEMPOTENCY. Stripe occasionally retries the same
--      webhook (especially on transient 5xx responses from our endpoint).
--      The `(stripe_event_id)` unique constraint lets us reject
--      duplicate deliveries cheaply — one INSERT, ON CONFLICT DO NOTHING.
--
--   2. AUDIT TRAIL. Every Stripe event we processed is preserved with
--      the raw payload so we can debug billing disputes 6 months later
--      without round-tripping to Stripe's dashboard.
--
--   3. RECONCILIATION. If a webhook handler fails mid-write, we have
--      the original event payload to replay against the same tenant
--      via the admin UI (Slice 4 will add the replay affordance).
--
-- Schema choices:
--   - `stripe_customer_id` lives on tenant_subscription, not on
--     organization. Reason: an org can theoretically have multiple
--     subscriptions over its lifetime (e.g. trial → paid → upgraded
--     tier reissued by Stripe). The current tenant_subscription row
--     always points at the live customer relationship.
--   - `payment_event` is platform-wide (no organization_id). Reason:
--     when Stripe fires a webhook, we don't yet know which tenant it
--     belongs to — we discover that by looking up the
--     stripe_customer_id in the payload. The handler resolves the
--     tenant after dedup-check. Audit trail is admin-only (same
--     posture as production_error which is also platform-wide).

ALTER TABLE "tenant_subscription"
  ADD COLUMN IF NOT EXISTS "stripe_customer_id" text;

ALTER TABLE "tenant_subscription"
  ADD COLUMN IF NOT EXISTS "stripe_subscription_id" text;

-- Look up tenant by Stripe customer id (webhook handlers).
CREATE INDEX IF NOT EXISTS "tenant_subscription_stripe_customer_idx"
  ON "tenant_subscription" ("stripe_customer_id")
  WHERE "stripe_customer_id" IS NOT NULL;

-- Look up tenant by Stripe subscription id (rarer; used when an event
-- carries the subscription id but not the customer id).
CREATE INDEX IF NOT EXISTS "tenant_subscription_stripe_subscription_idx"
  ON "tenant_subscription" ("stripe_subscription_id")
  WHERE "stripe_subscription_id" IS NOT NULL;

-- ── webhook event ledger ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "payment_event" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stripe's evt_* identifier — globally unique within Stripe.
  -- UNIQUE constraint gives us free idempotency.
  "stripe_event_id" text NOT NULL UNIQUE,
  -- "checkout.session.completed", "invoice.paid", etc. Top-level
  -- type from the Stripe event envelope.
  "event_type" text NOT NULL,
  -- The Stripe customer id from the event payload, when present.
  -- May be null for events not tied to a specific customer.
  "stripe_customer_id" text,
  -- Once resolved, the FORGE tenant this event belongs to. Stays
  -- null when we receive an event for an unknown customer (e.g.
  -- Stripe test fixtures, or a stripe_customer_id that we haven't
  -- bound to a tenant yet).
  "organization_id" uuid REFERENCES "organization"("id") ON DELETE SET NULL,
  -- Full Stripe event payload as received. Lets us replay handlers
  -- against historical events without re-fetching from Stripe.
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Handler outcome: "ok" / "failed" / "unhandled". `unhandled` is
  -- our explicit "we received this but the handler isn't wired yet"
  -- state — useful for verifying Slice 3+ work picks up the right
  -- events.
  "handler_status" text NOT NULL DEFAULT 'unhandled',
  -- Error message if handler_status = 'failed'. Bounded so a stack
  -- trace doesn't OOM a row.
  "handler_error" text NOT NULL DEFAULT '',
  "received_at" timestamp NOT NULL DEFAULT now(),
  "processed_at" timestamp
);

CREATE INDEX IF NOT EXISTS "payment_event_received_idx"
  ON "payment_event" ("received_at" DESC);

CREATE INDEX IF NOT EXISTS "payment_event_org_received_idx"
  ON "payment_event" ("organization_id", "received_at" DESC)
  WHERE "organization_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "payment_event_handler_status_idx"
  ON "payment_event" ("handler_status", "received_at" DESC)
  WHERE "handler_status" IN ('failed', 'unhandled');
