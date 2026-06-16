-- BL-PACKAGES Slice 1 — token-based AI cost cap.
--
-- The existing `subscription_tier.quotas.aiRequestsPerMonth` counts
-- requests, which is a poor proxy for cost. A single section-draft
-- call can consume 5000 tokens; a single capability-matrix run can
-- consume 8000. Per-request quotas can't distinguish a $0.01 prompt
-- from a $1.00 one. We need per-TOKEN quotas to actually protect
-- margins.
--
-- This migration adds `aiTokensPerMonth` to every existing tier's
-- quota JSONB. Default = 0 (unlimited semantics — same convention as
-- the other quota fields) so existing tiers don't suddenly start
-- rejecting calls. Super-admins set real caps via the tier-editor UI
-- (BL-PACKAGES Slice 3) or by direct UPDATE.
--
-- Pairs with `tenant_usage_counter` rows keyed on
-- `key = 'aiTokensPerMonth'`. The same monthly-period machinery
-- already used for `aiRequestsPerMonth` applies here unchanged.

UPDATE "subscription_tier"
  SET "quotas" = jsonb_set(
        "quotas",
        '{aiTokensPerMonth}',
        '0'::jsonb,
        true
      )
  WHERE NOT ("quotas" ? 'aiTokensPerMonth');

-- Sanity output: log how many rows we touched so the operator can
-- verify the backfill landed. (Postgres NOTICE messages surface in
-- the migration runner's stdout.)
DO $$
DECLARE
  remaining int;
BEGIN
  SELECT COUNT(*) INTO remaining
    FROM "subscription_tier"
    WHERE NOT ("quotas" ? 'aiTokensPerMonth');
  IF remaining > 0 THEN
    RAISE EXCEPTION 'BL-PACKAGES backfill failed — % subscription_tier rows still missing aiTokensPerMonth', remaining;
  END IF;
  RAISE NOTICE 'BL-PACKAGES backfill ok: every subscription_tier row carries aiTokensPerMonth';
END $$;
