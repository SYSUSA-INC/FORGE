-- BL-PACKAGES add-ons Slice 2c — the advancedReporting feature flag
-- (the Reports page). Existing tiers get the key so the tier editor
-- and the gate read it: on for the all-features tiers (gold, platinum,
-- custom), off for the rest. A tier that already has the key is left
-- alone. Idempotent; data only.

UPDATE "subscription_tier"
   SET "feature_flags" = "feature_flags" || '{"advancedReporting": true}'::jsonb
 WHERE "slug" IN ('gold', 'platinum', 'custom')
   AND "feature_flags" -> 'advancedReporting' IS NULL;--> statement-breakpoint
UPDATE "subscription_tier"
   SET "feature_flags" = "feature_flags" || '{"advancedReporting": false}'::jsonb
 WHERE "feature_flags" -> 'advancedReporting' IS NULL;
