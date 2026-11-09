-- BL-NAV-LIFECYCLE 4c-1 — the Plan's charter and its sign-off (P-2), the teaming agreement kept by hand (P-6), the bid budget estimate, the Q&A and amendment cut-offs and the risk list (P-7), all on opportunity_plan.
ALTER TABLE "opportunity_plan" ADD COLUMN IF NOT EXISTS "charter" jsonb NOT NULL DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "opportunity_plan" ADD COLUMN IF NOT EXISTS "charter_signed_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "opportunity_plan" ADD COLUMN IF NOT EXISTS "charter_signed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "opportunity_plan" ADD COLUMN IF NOT EXISTS "agreement_status" text NOT NULL DEFAULT 'todo';--> statement-breakpoint
ALTER TABLE "opportunity_plan" ADD COLUMN IF NOT EXISTS "agreement_date" date;--> statement-breakpoint
ALTER TABLE "opportunity_plan" ADD COLUMN IF NOT EXISTS "agreement_file_name" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "opportunity_plan" ADD COLUMN IF NOT EXISTS "agreement_storage_key" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "opportunity_plan" ADD COLUMN IF NOT EXISTS "agreement_file_size" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "opportunity_plan" ADD COLUMN IF NOT EXISTS "budget_hours" integer;--> statement-breakpoint
ALTER TABLE "opportunity_plan" ADD COLUMN IF NOT EXISTS "budget_dollars" bigint;--> statement-breakpoint
ALTER TABLE "opportunity_plan" ADD COLUMN IF NOT EXISTS "qa_cutoff_date" date;--> statement-breakpoint
ALTER TABLE "opportunity_plan" ADD COLUMN IF NOT EXISTS "amendment_cutoff_date" date;--> statement-breakpoint
ALTER TABLE "opportunity_plan" ADD COLUMN IF NOT EXISTS "risks" jsonb NOT NULL DEFAULT '[]'::jsonb;
