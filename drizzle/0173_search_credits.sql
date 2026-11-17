-- BL-NAV-LIFECYCLE 5b-2a — prepaid web-search packs: the balance and its ledger.
-- Design: docs/design/BL-NAV-LIFECYCLE_PHASE5B2_SEARCH_PACKS.md. Additive, idempotent.
--
-- A research run draws the plan's monthly allowance first (tenant_usage_counter)
-- and a pack only when the plan's searches are gone. Pack searches do not expire
-- and the tenant's own monthly cap does not limit them.

-- The packs FORGE sells (platform-wide, no tenant column). The price is sent
-- inline to Stripe Checkout in 5b-2b, so nothing is set up in Stripe per pack.
CREATE TABLE IF NOT EXISTS "search_pack" (
  "slug" varchar(64) PRIMARY KEY,
  "name" text NOT NULL,
  "searches" integer NOT NULL CHECK ("searches" > 0),
  "price_cents" integer NOT NULL CHECK ("price_cents" > 0),
  "currency" varchar(3) NOT NULL DEFAULT 'usd',
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now()
);
INSERT INTO "search_pack" ("slug", "name", "searches", "price_cents", "currency")
  VALUES ('searches-500', '500 web searches', 500, 2500, 'usd')
  ON CONFLICT ("slug") DO NOTHING;

-- One row per tenant: the pack searches it holds. Never below zero.
CREATE TABLE IF NOT EXISTS "tenant_search_credit" (
  "organization_id" uuid PRIMARY KEY REFERENCES "organization"("id") ON DELETE CASCADE,
  "balance" integer NOT NULL DEFAULT 0 CONSTRAINT "tenant_search_credit_balance_check" CHECK ("balance" >= 0),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Append-only ledger: every change to a balance, written in the same
-- transaction, so a balance always equals the sum of its entries.
-- kind: purchase | draw | release | refund | adjust.
CREATE TABLE IF NOT EXISTS "search_credit_entry" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "delta" integer NOT NULL,
  "kind" varchar(16) NOT NULL,
  "balance_after" integer NOT NULL,
  "pack_slug" varchar(64),
  "stripe_checkout_session_id" text,
  "stripe_event_id" text,
  "proposal_id" uuid REFERENCES "proposal"("id") ON DELETE SET NULL,
  "actor_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "note" text NOT NULL DEFAULT '',
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "search_credit_entry_org_idx"
  ON "search_credit_entry" ("organization_id", "created_at");
-- A Checkout session credits once, however many times Stripe delivers it.
CREATE UNIQUE INDEX IF NOT EXISTS "search_credit_entry_session_idx"
  ON "search_credit_entry" ("stripe_checkout_session_id")
  WHERE "stripe_checkout_session_id" IS NOT NULL;
