-- BL-16 Phase A — subscription tiers + tenant subscriptions.
--
-- Foundation for the tier model (Bronze / Silver / Gold / Platinum /
-- Custom). This migration adds the two tables, an enum for tenant
-- subscription status, seeds the five default tiers, and gives every
-- existing organization a `Platinum`-equivalent subscription so
-- runtime behavior is unchanged when BL-16 Phase B starts gating
-- features.
--
-- What this migration does NOT do (deferred to later BL-16 phases):
--   - Runtime feature gates (`ensureFeature(orgId, "winnerAnalysis")`)
--   - Promotional codes (`promotion_code` table)
--   - Super-admin UI to edit tier prices / features
--   - Webhook integration (Stripe / Paddle) — that's BL-17

-- ─────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────

CREATE TYPE "tenant_subscription_status" AS ENUM (
  'trial',
  'active',
  'past_due',
  'canceled',
  'paused'
);

-- ─────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE "subscription_tier" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "slug"                  varchar(32) NOT NULL UNIQUE,
  "name"                  text NOT NULL,
  "description"           text NOT NULL DEFAULT '',
  -- Prices stored in cents to avoid floating-point pain. 0 = free tier
  -- (e.g., Bronze can be a free intro tier at the team's discretion).
  "price_monthly_cents"   integer NOT NULL DEFAULT 0,
  "price_yearly_cents"    integer NOT NULL DEFAULT 0,
  -- Feature flags shape (TypeScript-typed in schema.ts):
  --   {
  --     aiAutoDraft: boolean,
  --     winnerAnalysis: boolean,
  --     complianceMatrix: boolean,
  --     bulkExport: boolean,
  --     apiAccess: boolean,
  --     customTemplates: boolean,
  --   }
  -- New flags get added by editing schema.ts + a follow-up migration
  -- that bumps existing rows' defaults.
  "feature_flags"         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Quotas shape:
  --   {
  --     aiRequestsPerMonth: number (0 = unlimited),
  --     seatsIncluded: number,
  --     storageGb: number,
  --     proposalsPerMonth: number,
  --   }
  "quotas"                jsonb NOT NULL DEFAULT '{}'::jsonb,
  "sort_order"            integer NOT NULL DEFAULT 0,
  "active"                boolean NOT NULL DEFAULT true,
  "created_at"            timestamp NOT NULL DEFAULT now(),
  "updated_at"            timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "subscription_tier_sort_idx" ON "subscription_tier" ("sort_order");

-- Each tenant has at most one subscription (one tier at a time). PK on
-- organization_id enforces 1:1. To change tiers, UPDATE the row.
-- History of past tiers is captured in `audit_log` via the eventual
-- BL-16 Phase B action that performs the change.
CREATE TABLE "tenant_subscription" (
  "organization_id"        uuid PRIMARY KEY REFERENCES "organization"("id") ON DELETE CASCADE,
  "tier_id"                uuid NOT NULL REFERENCES "subscription_tier"("id") ON DELETE RESTRICT,
  "status"                 "tenant_subscription_status" NOT NULL DEFAULT 'active',
  "current_period_start"   timestamp,
  "current_period_end"     timestamp,
  "trial_until"            timestamp,
  "cancel_at"              timestamp,
  -- Per-tenant overrides on top of the tier defaults. Same shape as
  -- the tier's feature_flags + quotas merged. Example:
  --   { "quotas": { "aiRequestsPerMonth": 5000 } }  -- bumps just one
  -- The runtime gate (Phase B) reads tier.X merged with overrides.X.
  "custom_overrides"       jsonb NOT NULL DEFAULT '{}'::jsonb,
  "notes"                  text NOT NULL DEFAULT '',
  "created_at"             timestamp NOT NULL DEFAULT now(),
  "updated_at"             timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "tenant_subscription_tier_idx" ON "tenant_subscription" ("tier_id");
CREATE INDEX "tenant_subscription_status_idx" ON "tenant_subscription" ("status");

-- ─────────────────────────────────────────────────────────────────────
-- Default tiers
-- ─────────────────────────────────────────────────────────────────────
--
-- Placeholder pricing — sales team adjusts via the Phase C admin UI.
-- Quotas use 0 to mean "unlimited" so the Platinum tier reads
-- naturally without negative numbers.

INSERT INTO "subscription_tier" (
  "slug", "name", "description", "price_monthly_cents", "price_yearly_cents",
  "feature_flags", "quotas", "sort_order"
) VALUES
  (
    'bronze',
    'Bronze',
    'Entry tier — core opportunity tracking and a small AI budget.',
    9900, 99000,
    '{"aiAutoDraft": false, "winnerAnalysis": false, "complianceMatrix": true, "bulkExport": false, "apiAccess": false, "customTemplates": false}'::jsonb,
    '{"aiRequestsPerMonth": 100, "seatsIncluded": 5, "storageGb": 10, "proposalsPerMonth": 5}'::jsonb,
    10
  ),
  (
    'silver',
    'Silver',
    'Mid tier — adds Winner Analysis and a larger AI budget.',
    24900, 249000,
    '{"aiAutoDraft": false, "winnerAnalysis": true, "complianceMatrix": true, "bulkExport": true, "apiAccess": false, "customTemplates": false}'::jsonb,
    '{"aiRequestsPerMonth": 500, "seatsIncluded": 15, "storageGb": 50, "proposalsPerMonth": 20}'::jsonb,
    20
  ),
  (
    'gold',
    'Gold',
    'All features unlocked, generous quotas.',
    49900, 499000,
    '{"aiAutoDraft": true, "winnerAnalysis": true, "complianceMatrix": true, "bulkExport": true, "apiAccess": true, "customTemplates": true}'::jsonb,
    '{"aiRequestsPerMonth": 2000, "seatsIncluded": 50, "storageGb": 200, "proposalsPerMonth": 100}'::jsonb,
    30
  ),
  (
    'platinum',
    'Platinum',
    'Unlimited quotas, all features, priority support.',
    99900, 999000,
    '{"aiAutoDraft": true, "winnerAnalysis": true, "complianceMatrix": true, "bulkExport": true, "apiAccess": true, "customTemplates": true}'::jsonb,
    '{"aiRequestsPerMonth": 0, "seatsIncluded": 0, "storageGb": 0, "proposalsPerMonth": 0}'::jsonb,
    40
  ),
  (
    'custom',
    'Custom',
    'Negotiated pricing and features — superadmins set per-tenant overrides.',
    0, 0,
    '{"aiAutoDraft": true, "winnerAnalysis": true, "complianceMatrix": true, "bulkExport": true, "apiAccess": true, "customTemplates": true}'::jsonb,
    '{"aiRequestsPerMonth": 0, "seatsIncluded": 0, "storageGb": 0, "proposalsPerMonth": 0}'::jsonb,
    50
  );

-- ─────────────────────────────────────────────────────────────────────
-- Backfill: every existing organization gets a Platinum subscription
-- ─────────────────────────────────────────────────────────────────────
--
-- This preserves zero behavior change when BL-16 Phase B introduces
-- runtime feature gates — every current tenant has all features
-- enabled and unlimited quotas until an admin explicitly downgrades
-- them. New organizations created after this migration land via the
-- onboarding flow (which Phase B will update to assign a tier
-- explicitly); they get Platinum by default at the application layer.

INSERT INTO "tenant_subscription" (
  "organization_id", "tier_id", "status", "notes"
)
SELECT
  o.id,
  (SELECT id FROM "subscription_tier" WHERE slug = 'platinum' LIMIT 1),
  'active',
  'Auto-seeded by migration 0043 to preserve unrestricted behavior before BL-16 Phase B runtime gates ship.'
FROM "organization" o
WHERE NOT EXISTS (
  SELECT 1 FROM "tenant_subscription" t
  WHERE t.organization_id = o.id
);
