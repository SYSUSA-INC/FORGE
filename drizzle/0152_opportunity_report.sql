-- BL-NAV-LIFECYCLE phase 2b-2 — the opportunity's reports (FORGE II
-- footnote 5, E-8, E-9): each Matrix Report (and, in 2c, Analysis Report)
-- is a dated snapshot kept as its own version, with who saved it, so the
-- opportunity's page keeps them through Capture, Plan and Develop.
-- Idempotent and additive.

DO $$ BEGIN
  CREATE TYPE "opportunity_report_kind" AS ENUM ('matrix', 'analysis');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "opportunity_report" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "opportunity_id" uuid NOT NULL REFERENCES "opportunity"("id") ON DELETE CASCADE,
  "kind" "opportunity_report_kind" NOT NULL,
  "version" integer NOT NULL,
  "body" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunity_report_org_idx" ON "opportunity_report" ("organization_id", "created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "opportunity_report_version_uq" ON "opportunity_report" ("opportunity_id", "kind", "version");
