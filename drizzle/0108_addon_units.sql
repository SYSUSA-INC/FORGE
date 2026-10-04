-- BL-PACKAGES add-ons Slice 2b — seats and storage as add-on kinds.
--
-- tier_addon.kind gains 'seats' (extra seats per unit) and 'storage'
-- (extra GB per unit); amount_per_unit holds that number for those two
-- kinds (0 for token top-ups and feature unlocks, which keep their own
-- columns). kind is plain text, so no enum change. Idempotent, additive.

ALTER TABLE "tier_addon" ADD COLUMN IF NOT EXISTS "amount_per_unit" integer NOT NULL DEFAULT 0;
