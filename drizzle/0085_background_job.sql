-- BL-AIP-4c — durable background jobs with stuck-row recovery.
--
-- Solicitation parses, companion-document parses and proposal harvests
-- used to run as fire-and-forget promises after the response. Vercel's
-- waitUntil (BL-AIP-4) keeps the instance alive in the common case, but
-- a deploy, a timeout or a crash mid-run still left the row at
-- "parsing" forever with nothing to retry it. Each such run is now a
-- row here: the request enqueues it and starts it at once; the jobs
-- cron re-runs rows whose instance died (running for longer than the
-- stuck window) from the stored file bytes, backs off between
-- attempts, and marks a row failed after max_attempts.
--
-- resource_id is the row the job acts on (solicitation, companion
-- document or proposal); payload carries what the handler needs beyond
-- that. Every row carries organization_id. Idempotent and additive.

CREATE TYPE "background_job_kind" AS ENUM (
  'solicitation_parse',
  'solicitation_document_parse',
  'proposal_harvest'
);--> statement-breakpoint
CREATE TYPE "background_job_status" AS ENUM ('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "background_job" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"       uuid        NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "kind"                  "background_job_kind" NOT NULL,
  "resource_id"           uuid        NOT NULL,
  "payload"               jsonb       NOT NULL DEFAULT '{}',
  "status"                "background_job_status" NOT NULL DEFAULT 'queued',
  "attempts"              integer     NOT NULL DEFAULT 0,
  "max_attempts"          integer     NOT NULL DEFAULT 3,
  "next_attempt_at"       timestamptz NOT NULL DEFAULT now(),
  "started_at"            timestamptz,
  "finished_at"           timestamptz,
  "error"                 text        NOT NULL DEFAULT '',
  "requested_by_user_id"  text        REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_job_org_created_idx" ON "background_job" ("organization_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_job_resource_idx" ON "background_job" ("kind", "resource_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "background_job_open_idx" ON "background_job" ("status", "next_attempt_at") WHERE "status" IN ('queued', 'running');
