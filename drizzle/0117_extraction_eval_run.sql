-- BL-AIX Phase 1e-3 — the extraction accuracy run.
--
-- One row per run of FORGE's live extraction over the approved gold
-- documents: the prompt versions and model it ran on, the documents it
-- covered, a resumable cursor while it is running, per-document results
-- and the run's summary (requirement recall and precision, page-limit
-- capture, Section M factor recall and order). A platform table like the
-- gold set itself: no organization_id, no tenant data. Idempotent,
-- additive.

CREATE TABLE IF NOT EXISTS "extraction_eval_run" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "status"              text        NOT NULL DEFAULT 'running',
  "prompt_versions"     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  "model"               text        NOT NULL DEFAULT '',
  "doc_ids"             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  "cursor"              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  "results"             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  "summary"             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  "error"               text        NOT NULL DEFAULT '',
  "started_by_user_id"  text        REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "finished_at"         timestamptz
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "extraction_eval_run_created_idx" ON "extraction_eval_run" ("created_at");
