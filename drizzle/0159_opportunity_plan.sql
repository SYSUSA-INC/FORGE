-- BL-NAV-LIFECYCLE 4a — the Plan: one plan per opportunity, its team with the RACI letters and the colour teams, and the plan_role_assigned notification (the default rule follows in 0160: an INSERT cannot reference an enum value added in the same transaction).
DO $$ BEGIN
  CREATE TYPE "plan_role" AS ENUM ('capture_lead', 'proposal_manager', 'technical_lead', 'pricing_lead', 'compliance_reviewer', 'color_team_reviewer', 'subject_matter_expert', 'contributor', 'observer', 'executive_sponsor', 'contracts');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER TYPE "notification_trigger_event_kind" ADD VALUE IF NOT EXISTS 'plan_role_assigned';--> statement-breakpoint
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'plan_role_assigned';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "opportunity_plan" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "opportunity_id" uuid NOT NULL REFERENCES "opportunity"("id") ON DELETE CASCADE,
  "solicitation_id" uuid REFERENCES "solicitation"("id") ON DELETE SET NULL,
  "team_seeded_at" timestamp with time zone,
  "created_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "opportunity_plan_opp_uq" ON "opportunity_plan" ("opportunity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunity_plan_org_idx" ON "opportunity_plan" ("organization_id", "created_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "opportunity_plan_role" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "plan_id" uuid NOT NULL REFERENCES "opportunity_plan"("id") ON DELETE CASCADE,
  "opportunity_id" uuid NOT NULL REFERENCES "opportunity"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "role" "plan_role" NOT NULL,
  "color_team" "review_color",
  "raci" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "notes" text DEFAULT '' NOT NULL,
  "source" text DEFAULT 'manual' NOT NULL,
  "assigned_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunity_plan_role_org_idx" ON "opportunity_plan_role" ("organization_id", "assigned_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunity_plan_role_opp_idx" ON "opportunity_plan_role" ("opportunity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunity_plan_role_user_idx" ON "opportunity_plan_role" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "opportunity_plan_role_color_uq" ON "opportunity_plan_role" ("plan_id", "user_id", "role", "color_team") WHERE color_team IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "opportunity_plan_role_plain_uq" ON "opportunity_plan_role" ("plan_id", "user_id", "role") WHERE color_team IS NULL;
