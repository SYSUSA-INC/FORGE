-- BL-NAV-LIFECYCLE 4b-1 — the Plan's milestones: one row per milestone on an opportunity's plan (kind, date, owner, status, the key date it hangs on), and the milestone_due_soon trigger and inbox kind (the default rule follows in 0162: an INSERT cannot reference an enum value added in the same transaction).
DO $$ BEGIN
  CREATE TYPE "milestone_kind" AS ENUM ('kick_off', 'outline_frozen', 'pink_team', 'red_team', 'gold_team', 'white_gloves', 'pricing_complete', 'final_production', 'submit', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "milestone_status" AS ENUM ('planned', 'done', 'missed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER TYPE "notification_trigger_event_kind" ADD VALUE IF NOT EXISTS 'milestone_due_soon';--> statement-breakpoint
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'milestone_due_soon';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "opportunity_milestone" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "opportunity_id" uuid NOT NULL REFERENCES "opportunity"("id") ON DELETE CASCADE,
  "plan_id" uuid NOT NULL REFERENCES "opportunity_plan"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "kind" "milestone_kind" DEFAULT 'other' NOT NULL,
  "date" date NOT NULL,
  "owner_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "status" "milestone_status" DEFAULT 'planned' NOT NULL,
  "anchor_key" text,
  "notes" text DEFAULT '' NOT NULL,
  "created_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunity_milestone_org_opp_date_idx" ON "opportunity_milestone" ("organization_id", "opportunity_id", "date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunity_milestone_owner_idx" ON "opportunity_milestone" ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunity_milestone_date_idx" ON "opportunity_milestone" ("status", "date");
