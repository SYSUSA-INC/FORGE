-- BL-NAV-LIFECYCLE phase 2a — the Evaluate decision (FORGE II footnote 5):
-- GO, NO-GO or PARTNER, each a record kept (a changed decision is a new
-- row), with a No-Go's reason category and words, who decided, and the
-- PWin and capability coverage at that moment. Idempotent and additive.

DO $$ BEGIN
  CREATE TYPE "opportunity_decision_kind" AS ENUM ('go', 'no_go', 'partner');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "opportunity_decision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "opportunity_id" uuid NOT NULL REFERENCES "opportunity"("id") ON DELETE CASCADE,
  "decision" "opportunity_decision_kind" NOT NULL,
  "reason_category" text DEFAULT '' NOT NULL,
  "reason" text DEFAULT '' NOT NULL,
  "pwin" integer,
  "coverage" real,
  "decided_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunity_decision_org_idx" ON "opportunity_decision" ("organization_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunity_decision_opp_idx" ON "opportunity_decision" ("opportunity_id", "created_at");
