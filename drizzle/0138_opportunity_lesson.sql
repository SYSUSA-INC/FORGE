-- BL-LESSONS-LOOP phase 4a — lessons from decided bids, drafted by FORGE
-- and confirmed by a person, and where each was applied. Idempotent and
-- additive.
CREATE TABLE IF NOT EXISTS "opportunity_lesson" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"proposal_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"kind" text DEFAULT 'do' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"applies_to" jsonb DEFAULT '{"agencies":[],"naicsCodes":[],"sectionKinds":[],"capabilities":[]}'::jsonb NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"confirmed_by_user_id" text,
	"confirmed_at" timestamp,
	"created_by_user_id" text,
	"applied_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunity_lesson" ADD CONSTRAINT "opportunity_lesson_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_lesson" ADD CONSTRAINT "opportunity_lesson_opportunity_id_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_lesson" ADD CONSTRAINT "opportunity_lesson_proposal_id_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_lesson" ADD CONSTRAINT "opportunity_lesson_confirmed_by_user_id_user_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_lesson" ADD CONSTRAINT "opportunity_lesson_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunity_lesson_org_idx" ON "opportunity_lesson" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunity_lesson_org_opp_idx" ON "opportunity_lesson" USING btree ("organization_id", "opportunity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunity_lesson_org_status_idx" ON "opportunity_lesson" USING btree ("organization_id", "status");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "opportunity_lesson_application" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"section_id" uuid,
	"applied_by_user_id" text,
	"applied_at" timestamp DEFAULT now() NOT NULL,
	"outcome_type" text
);
--> statement-breakpoint
ALTER TABLE "opportunity_lesson_application" ADD CONSTRAINT "opportunity_lesson_application_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_lesson_application" ADD CONSTRAINT "opportunity_lesson_application_lesson_id_opportunity_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."opportunity_lesson"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_lesson_application" ADD CONSTRAINT "opportunity_lesson_application_proposal_id_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_lesson_application" ADD CONSTRAINT "opportunity_lesson_application_section_id_proposal_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."proposal_section"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_lesson_application" ADD CONSTRAINT "opportunity_lesson_application_applied_by_user_id_user_id_fk" FOREIGN KEY ("applied_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunity_lesson_application_org_idx" ON "opportunity_lesson_application" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunity_lesson_application_lesson_idx" ON "opportunity_lesson_application" USING btree ("lesson_id");
