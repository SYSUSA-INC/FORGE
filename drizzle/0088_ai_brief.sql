-- BL-AIP-7a — stored, grounded, graded briefs.
--
-- The pursuit brief and the pipeline brief were generated into an
-- in-process five-minute cache: nothing persisted, no feedback, no
-- grading against the outcome. Each generation is now a row here with
-- the snapshot it was written from, the model's structured
-- recommendation (pursuit: pursue / watch / no_bid + confidence), the
-- reader's feedback, and — once the opportunity closes — the outcome
-- and whether the call was right. Every row carries organization_id.
-- Idempotent and additive.

CREATE TYPE "ai_brief_kind" AS ENUM ('pursuit', 'pipeline');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_brief" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"       uuid        NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "kind"                  "ai_brief_kind" NOT NULL,
  "opportunity_id"        uuid        REFERENCES "opportunity"("id") ON DELETE CASCADE,
  "prompt_version"        text        NOT NULL DEFAULT '',
  "model"                 text        NOT NULL DEFAULT '',
  "stubbed"               boolean     NOT NULL DEFAULT false,
  "snapshot_key"          text        NOT NULL DEFAULT '',
  "snapshot"              jsonb       NOT NULL DEFAULT '{}',
  "text"                  text        NOT NULL DEFAULT '',
  "recommendation"        text,
  "confidence"            real,
  "signals"               jsonb       NOT NULL DEFAULT '[]',
  "next_actions"          jsonb       NOT NULL DEFAULT '[]',
  "feedback"              text,
  "feedback_user_id"      text        REFERENCES "user"("id") ON DELETE SET NULL,
  "feedback_at"           timestamptz,
  "outcome"               text,
  "grade"                 text,
  "graded_at"             timestamptz,
  "requested_by_user_id"  text        REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at"            timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_brief_org_created_idx" ON "ai_brief" ("organization_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_brief_opportunity_idx" ON "ai_brief" ("opportunity_id", "created_at");
