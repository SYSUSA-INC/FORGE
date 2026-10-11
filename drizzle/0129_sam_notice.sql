-- BL-STAB-10b — FORGE's copy of the descriptions in SAM.gov's public
-- Contract Opportunities file (published nightly, no API key). Platform
-- reference data, like cert_firm: no organization_id, no user, nothing
-- about who searched what. Written only by the CRON_SECRET-gated load
-- (src/lib/sam-notice-load.ts). Idempotent and additive.

CREATE TABLE IF NOT EXISTS "sam_notice" (
  "notice_id"   varchar(32) PRIMARY KEY,
  "description" text,
  "state"       varchar(10) NOT NULL,
  "posted_at"   timestamp,
  "digest"      varchar(32) NOT NULL,
  "gone_on"     date
);
CREATE INDEX IF NOT EXISTS "sam_notice_gone_idx" ON "sam_notice" ("gone_on") WHERE "gone_on" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "sam_notice_load_run" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "started_at"         timestamptz NOT NULL DEFAULT now(),
  "finished_at"        timestamptz,
  "status"             varchar(12) NOT NULL DEFAULT 'running',
  "etag"               text NOT NULL DEFAULT '',
  "source_modified_at" timestamptz,
  "bytes"              bigint NOT NULL DEFAULT 0,
  "rows_seen"          integer NOT NULL DEFAULT 0,
  "rows_written"       integer NOT NULL DEFAULT 0,
  "rows_gone"          integer NOT NULL DEFAULT 0,
  "rows_purged"        integer NOT NULL DEFAULT 0,
  "rows_skipped"       integer NOT NULL DEFAULT 0,
  "newest_posted_at"   timestamp,
  "error"              text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS "sam_notice_load_run_started_idx" ON "sam_notice_load_run" ("started_at");
