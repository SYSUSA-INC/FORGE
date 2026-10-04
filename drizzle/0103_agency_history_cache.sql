-- BL-FB-X-CRM Slice 3 — what USAspending last said about an agency, per
-- tenant: the awards and summary the contacts pages show, kept for a day
-- so the panel opens instantly and the public API is asked at most once
-- per agency per day. One row per (organization, agency key).
-- Idempotent and additive.

CREATE TABLE IF NOT EXISTS "agency_history_cache" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "agency_key"      text NOT NULL,
  "agency"          text NOT NULL,
  "payload"         jsonb NOT NULL,
  "fetched_at"      timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agency_history_cache_org_agency_idx" ON "agency_history_cache" ("organization_id", "agency_key");
