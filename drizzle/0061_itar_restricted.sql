-- BL-ITAR-TAG — ITAR-restricted tenant tagging.
--
-- Adds:
--   - `organization.itar_restricted` — when true, every new member
--     must be admin-attested as a US person at invite time.
--   - `allowlist.us_person_attested` + `_at` — captured at the
--     invite row when the org is ITAR-restricted; survives consume.
--   - `membership.us_person_attested` + `_at` — copied from the
--     allowlist row on consume so per-member queries don't need a
--     join through the (eventually expired) allowlist row.
--
-- Behaviour for existing tenants: backfill is `false` everywhere.
-- Existing memberships are grandfathered — the gate only fires on
-- NEW invites for tenants that are ITAR-restricted.

ALTER TABLE "organization"
  ADD COLUMN "itar_restricted" boolean NOT NULL DEFAULT false;

ALTER TABLE "allowlist"
  ADD COLUMN "us_person_attested" boolean NOT NULL DEFAULT false;
ALTER TABLE "allowlist"
  ADD COLUMN "us_person_attested_at" timestamp;

ALTER TABLE "membership"
  ADD COLUMN "us_person_attested" boolean NOT NULL DEFAULT false;
ALTER TABLE "membership"
  ADD COLUMN "us_person_attested_at" timestamp;
