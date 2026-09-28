-- BL-AIP-5b (part ii) — the golden eval set.
--
-- ai_eval_run stores one run of the golden eval: the drafter re-drafts
-- sections of WON proposals from the solicitation context alone (the
-- saved body withheld) and each draft is scored deterministically
-- against the text that won. Keyed by the drafter's prompt_version and
-- the model so a prompt change is comparable to the previous one.
-- Every row carries organization_id. Idempotent and additive.

CREATE TABLE IF NOT EXISTS "ai_eval_run" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"       uuid        NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "feature"               text        NOT NULL DEFAULT 'section_draft',
  "prompt_version"        text        NOT NULL DEFAULT '',
  "model"                 text        NOT NULL DEFAULT '',
  "case_count"            integer     NOT NULL DEFAULT 0,
  "mean_score"            real        NOT NULL DEFAULT 0,
  "results"               jsonb       NOT NULL DEFAULT '[]',
  "stubbed"               boolean     NOT NULL DEFAULT false,
  "requested_by_user_id"  text        REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at"            timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_eval_run_org_created_idx" ON "ai_eval_run" ("organization_id", "created_at");
