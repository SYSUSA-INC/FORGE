-- BL-AIX Phase 1h-2 — expert ratings that calibrate the draft judge.
--
-- ai_eval_rating: one organization member's 1-5 rating of one golden-eval
-- draft (run + section) on the judge's rubric, with an overall score and
-- a note. One rating per member per draft; re-rating replaces it. The
-- judge's agreement with these ratings decides whether it can be trusted.
-- Tenant-scoped; idempotent, additive.

CREATE TABLE IF NOT EXISTS "ai_eval_rating" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "run_id" uuid NOT NULL,
  "section_id" uuid NOT NULL,
  "rater_user_id" text NOT NULL,
  "scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "overall" integer NOT NULL,
  "note" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_eval_rating" ADD CONSTRAINT "ai_eval_rating_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_eval_rating" ADD CONSTRAINT "ai_eval_rating_run_id_ai_eval_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."ai_eval_run"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_eval_rating" ADD CONSTRAINT "ai_eval_rating_rater_user_id_user_id_fk" FOREIGN KEY ("rater_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_eval_rating_org_run_idx" ON "ai_eval_rating" USING btree ("organization_id", "run_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_eval_rating_run_section_rater_idx" ON "ai_eval_rating" USING btree ("run_id", "section_id", "rater_user_id");
