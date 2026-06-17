-- BL-ENV-SEP — environment marker.
--
-- Defense-in-depth against the worst possible deployment misconfig:
-- a staging or preview Vercel project accidentally pointed at the
-- prod Neon project. Without this, dev work could write into the
-- prod DB and we'd find out from corrupted customer data.
--
-- How it works:
--   - This table holds exactly one row, recording which environment
--     "owns" this database (production / staging / preview / development).
--   - On first boot against an empty DB, the runtime helper inserts a
--     row using the current VERCEL_ENV value (or FORGE_ENV_OVERRIDE
--     if explicitly set by the operator).
--   - On every subsequent boot, the helper compares the runtime
--     environment to the stored marker. Mismatch → crash the process
--     immediately instead of letting the wrong env touch this data.
--
-- Operator override:
--   - To re-label an environment (e.g. demote a former-prod DB to
--     staging during a cutover), use the `/admin/migrations` UI or run
--     `UPDATE _forge_env SET expected_env = 'staging'` directly. The
--     normal Vercel env-var swap won't be enough — the marker is the
--     authoritative source.
--
-- This table is platform-wide (no organization_id) by design; it's
-- infrastructure metadata, not tenant data.

CREATE TABLE IF NOT EXISTS "_forge_env" (
  "id" integer PRIMARY KEY DEFAULT 1,
  "expected_env" text NOT NULL,
  "first_seen_at" timestamptz NOT NULL DEFAULT now(),
  "last_verified_at" timestamptz NOT NULL DEFAULT now(),
  -- Singleton guard. PostgreSQL doesn't have a clean "max 1 row"
  -- constraint, but a CHECK on the PK does the job: any INSERT
  -- attempting id != 1 is rejected.
  CONSTRAINT "_forge_env_singleton" CHECK ("id" = 1)
);
