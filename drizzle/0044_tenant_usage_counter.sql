-- BL-16 Phase B-3a — tenant usage counters for quota enforcement.
--
-- Tracks per-tenant, per-quota-key counter values per monthly billing
-- period. Phase B-3a ships the schema + the `enforceQuota` helper;
-- Phase B-3b wires the helper into the quota-bounded call sites
-- (AI request counts in particular). Phase B-3c adds period-rollover
-- semantics if needed (likely not — old rows are historical data
-- and don't interfere with the current-period lookup).
--
-- Period semantics:
--   - Period = calendar month, UTC.
--   - `period_start` = first of the month at 00:00:00 UTC.
--   - `period_end`   = first of the NEXT month at 00:00:00 UTC.
--   - Each new month, a new row is created lazily via UPSERT in the
--     helper. Old rows stay around as historical data.
--
-- Quota key conventions (matching TierQuotas in schema.ts):
--   - "aiRequestsPerMonth"
--   - "proposalsPerMonth"
--   - "storageGb"          (not a counter — measured live from
--                            knowledge_artifact.file_size; included
--                            here for forward-compat)
--   - "seatsIncluded"      (not a counter — measured live from
--                            membership.status='active' count;
--                            included here for forward-compat)

CREATE TABLE "tenant_usage_counter" (
  "organization_id"  uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "key"              varchar(64) NOT NULL,
  "period_start"     timestamp NOT NULL,
  "period_end"       timestamp NOT NULL,
  "value"            integer NOT NULL DEFAULT 0,
  "updated_at"       timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("organization_id", "key", "period_start")
);

-- Lookup index: most queries hit (org, key) for the current period.
-- The PK already covers this prefix but a separate index on
-- (org, key, period_end DESC) speeds up "show me the last N periods"
-- analytics queries the admin UI may want later.
CREATE INDEX "tenant_usage_counter_period_idx"
  ON "tenant_usage_counter" ("organization_id", "key", "period_end" DESC);
