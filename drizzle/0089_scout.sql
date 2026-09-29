-- BL-AIP-7b — the nightly scout.
--
-- Every night the scout re-runs each tenant's NAICS codes and keywords
-- against SAM.gov, checks the tenant's watchlist for expiring awards,
-- scores each find against the tenant's own history (recompete radar,
-- customer record, set-aside eligibility) and asks the model for a
-- pursue / watch / skip triage. A person imports or dismisses each
-- candidate; the decision grades the triage and feeds the next night's
-- prompt. scout_profile: settings (optional, one row per tenant);
-- scout_run: one row per run; scout_candidate: one row per find.
-- Every row carries organization_id. Idempotent and additive.

DO $$ BEGIN
  CREATE TYPE "scout_candidate_status" AS ENUM ('new', 'imported', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "scout_candidate_source" AS ENUM ('org_naics', 'keyword', 'watchlist_award');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scout_profile" (
  "organization_id"     uuid        PRIMARY KEY REFERENCES "organization"("id") ON DELETE CASCADE,
  "enabled"             boolean     NOT NULL DEFAULT true,
  "keywords"            text[]      NOT NULL DEFAULT ARRAY[]::text[],
  "extra_naics"         text[]      NOT NULL DEFAULT ARRAY[]::text[],
  "posted_days_back"    integer     NOT NULL DEFAULT 3,
  "last_run_at"         timestamptz,
  "updated_by_user_id"  text        REFERENCES "user"("id") ON DELETE SET NULL,
  "updated_at"          timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scout_run" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"       uuid        NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "trigger"               text        NOT NULL DEFAULT 'cron',
  "searches"              integer     NOT NULL DEFAULT 0,
  "found"                 integer     NOT NULL DEFAULT 0,
  "created"               integer     NOT NULL DEFAULT 0,
  "triaged"               integer     NOT NULL DEFAULT 0,
  "skipped_gated"         integer     NOT NULL DEFAULT 0,
  "errors"                integer     NOT NULL DEFAULT 0,
  "stubbed"               boolean     NOT NULL DEFAULT false,
  "note"                  text        NOT NULL DEFAULT '',
  "requested_by_user_id"  text        REFERENCES "user"("id") ON DELETE SET NULL,
  "started_at"            timestamptz NOT NULL DEFAULT now(),
  "finished_at"           timestamptz
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scout_run_org_started_idx" ON "scout_run" ("organization_id", "started_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scout_candidate" (
  "id"                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"       uuid        NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "run_id"                uuid        REFERENCES "scout_run"("id") ON DELETE SET NULL,
  "source"                "scout_candidate_source" NOT NULL,
  "status"                "scout_candidate_status" NOT NULL DEFAULT 'new',
  "notice_id"             text        NOT NULL,
  "title"                 text        NOT NULL DEFAULT '',
  "agency"                text        NOT NULL DEFAULT '',
  "office"                text        NOT NULL DEFAULT '',
  "solicitation_number"   text        NOT NULL DEFAULT '',
  "notice_type"           text        NOT NULL DEFAULT '',
  "set_aside"             text        NOT NULL DEFAULT '',
  "naics_code"            text        NOT NULL DEFAULT '',
  "psc_code"              text        NOT NULL DEFAULT '',
  "incumbent"             text        NOT NULL DEFAULT '',
  "posted_at"             timestamp,
  "response_due_at"       timestamp,
  "place_of_performance"  text        NOT NULL DEFAULT '',
  "description"           text        NOT NULL DEFAULT '',
  "ui_link"               text        NOT NULL DEFAULT '',
  "fit_score"             integer     NOT NULL DEFAULT 0,
  "signals"               jsonb       NOT NULL DEFAULT '[]',
  "recommendation"        text,
  "confidence"            real,
  "rationale"             text        NOT NULL DEFAULT '',
  "next_actions"          jsonb       NOT NULL DEFAULT '[]',
  "prompt_version"        text        NOT NULL DEFAULT '',
  "model"                 text        NOT NULL DEFAULT '',
  "stubbed"               boolean     NOT NULL DEFAULT false,
  "grade"                 text,
  "decided_by_user_id"    text        REFERENCES "user"("id") ON DELETE SET NULL,
  "decided_at"            timestamptz,
  "opportunity_id"        uuid        REFERENCES "opportunity"("id") ON DELETE SET NULL,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  "updated_at"            timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scout_candidate_org_notice_idx" ON "scout_candidate" ("organization_id", "notice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scout_candidate_org_status_created_idx" ON "scout_candidate" ("organization_id", "status", "created_at");
