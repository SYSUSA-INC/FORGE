-- BL-17 Slice 3 — Stripe Price binding on subscription_tier.
--
-- Super-admin configures tiers via /admin/tiers (FORGE-side). For
-- each tier, they also create a Stripe Product with two Prices
-- (monthly + yearly) in the Stripe Dashboard. The two columns added
-- here bind FORGE tiers to their Stripe Price counterparts so the
-- Checkout server action can hand Stripe the right Price id.
--
-- Why two columns instead of a `stripe_price_id` array: queries are
-- always "which Price for this tier, this billing period" — two
-- named columns are simpler than indexing into an array.
--
-- Nullable: a tier with no Stripe Price is "not buyable via
-- self-serve checkout" — useful for Enterprise tiers that go through
-- a sales-assisted invoice flow (BL-17 Slice 5).
--
-- No index needed: lookups are always `WHERE slug = ?` or
-- `WHERE id = ?` (the existing PK + slug-unique index handle those);
-- the new columns are projected, not filtered.

ALTER TABLE "subscription_tier"
  ADD COLUMN IF NOT EXISTS "stripe_price_id_monthly" text;

ALTER TABLE "subscription_tier"
  ADD COLUMN IF NOT EXISTS "stripe_price_id_yearly" text;
