-- BL-25 follow-on: generalize the 8(a) participant registry to a
-- multi-cert "cert_firm" table so we can also track HUBZone, WOSB,
-- EDWOSB, SDVOSB, VOB, and Native American certifications.
--
-- Migration approach:
--   1. ADD cert_type column with default '8a' so existing rows get a
--      sensible value as soon as the column lands.
--   2. Build the new unique index on (uei, cert_type) BEFORE dropping
--      the old uei-only one — a firm with multiple certs gets one row
--      per cert.
--   3. Drop the legacy uei unique constraint (it would prevent
--      multi-cert rows).
--   4. RENAME the two legacy tables to their general names.
--   5. Rename the indexes for clarity.
--
-- Same treatment for sba_8a_import_run → cert_import_run so the
-- audit trail tracks per-cert-type pulls.

-- ── cert_firm ─────────────────────────────────────────────────────
ALTER TABLE "sba_8a_participant"
  ADD COLUMN "cert_type" text NOT NULL DEFAULT '8a';

CREATE UNIQUE INDEX IF NOT EXISTS "cert_firm_uei_cert_type_idx"
  ON "sba_8a_participant" ("uei", "cert_type");

-- The legacy uei-only uniqueness was created by `"uei" text NOT NULL
-- UNIQUE` in 0035. Drizzle names it `<table>_uei_unique` or
-- `<table>_uei_key` depending on the postgres version. Try both.
ALTER TABLE "sba_8a_participant"
  DROP CONSTRAINT IF EXISTS "sba_8a_participant_uei_unique";
ALTER TABLE "sba_8a_participant"
  DROP CONSTRAINT IF EXISTS "sba_8a_participant_uei_key";

ALTER TABLE "sba_8a_participant" RENAME TO "cert_firm";

ALTER INDEX IF EXISTS "sba_8a_participant_name_norm_idx"
  RENAME TO "cert_firm_name_norm_idx";
ALTER INDEX IF EXISTS "sba_8a_participant_exit_date_idx"
  RENAME TO "cert_firm_exit_date_idx";

-- ── cert_import_run ───────────────────────────────────────────────
ALTER TABLE "sba_8a_import_run"
  ADD COLUMN "cert_type" text NOT NULL DEFAULT '8a';

ALTER TABLE "sba_8a_import_run" RENAME TO "cert_import_run";

ALTER INDEX IF EXISTS "sba_8a_import_run_started_idx"
  RENAME TO "cert_import_run_started_idx";
