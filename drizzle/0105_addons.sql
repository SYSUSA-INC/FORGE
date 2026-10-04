-- BL-PACKAGES add-ons Slice 1 — à la carte add-ons on top of a tier.
--
-- tier_addon is the platform catalogue (not tenant-scoped): what can be
-- bought or granted, what it gives (extra AI tokens per month, or one
-- feature flag) and, when sold by card, the Stripe Price it maps to.
-- tenant_addon is a tenant's grant of one catalogue entry: manual
-- (platform admin) or Stripe (checkout); the subscription gate adds the
-- active grants' effects on top of the tier and overrides.
-- Idempotent and additive.

CREATE TABLE IF NOT EXISTS "tier_addon" (
  "id"                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  "slug"                  varchar(32)  NOT NULL UNIQUE,
  "name"                  text         NOT NULL,
  "description"           text         NOT NULL DEFAULT '',
  "kind"                  text         NOT NULL DEFAULT 'ai_tokens',
  "ai_tokens_per_month"   integer      NOT NULL DEFAULT 0,
  "feature_flag"          text,
  "price_monthly_cents"   integer      NOT NULL DEFAULT 0,
  "stripe_price_id"       text,
  "sort_order"            integer      NOT NULL DEFAULT 0,
  "active"                boolean      NOT NULL DEFAULT true,
  "created_at"            timestamp    NOT NULL DEFAULT now(),
  "updated_at"            timestamp    NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_addon" (
  "id"                          uuid       PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"             uuid       NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "addon_id"                    uuid       NOT NULL REFERENCES "tier_addon"("id") ON DELETE RESTRICT,
  "quantity"                    integer    NOT NULL DEFAULT 1,
  "status"                      text       NOT NULL DEFAULT 'active',
  "source"                      text       NOT NULL DEFAULT 'manual',
  "stripe_subscription_id"      text,
  "stripe_subscription_item_id" text,
  "granted_by_user_id"          text       REFERENCES "user"("id") ON DELETE SET NULL,
  "note"                        text       NOT NULL DEFAULT '',
  "starts_at"                   timestamp  NOT NULL DEFAULT now(),
  "ends_at"                     timestamp,
  "canceled_at"                 timestamp,
  "created_at"                  timestamp  NOT NULL DEFAULT now(),
  "updated_at"                  timestamp  NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_addon_org_status_idx" ON "tenant_addon" ("organization_id", "status");
