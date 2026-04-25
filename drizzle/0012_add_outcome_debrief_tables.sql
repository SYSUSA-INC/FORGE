CREATE TYPE "public"."proposal_debrief_format" AS ENUM('written', 'oral', 'both', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."proposal_debrief_status" AS ENUM('not_requested', 'requested', 'scheduled', 'held', 'declined_by_govt', 'not_offered', 'waived');--> statement-breakpoint
CREATE TYPE "public"."proposal_outcome_reason" AS ENUM('price', 'technical', 'past_performance', 'management', 'relationship', 'schedule', 'requirements_fit', 'competition', 'compliance_gap', 'other');--> statement-breakpoint
CREATE TYPE "public"."proposal_outcome_type" AS ENUM('won', 'lost', 'no_bid', 'withdrawn');--> statement-breakpoint
CREATE TABLE "proposal_debrief" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"outcome_id" uuid,
	"organization_id" uuid NOT NULL,
	"status" "proposal_debrief_status" DEFAULT 'not_requested' NOT NULL,
	"format" "proposal_debrief_format" DEFAULT 'unknown' NOT NULL,
	"requested_at" timestamp,
	"scheduled_for" timestamp,
	"held_on" timestamp,
	"government_attendees" text DEFAULT '' NOT NULL,
	"our_attendees" text DEFAULT '' NOT NULL,
	"strengths" text DEFAULT '' NOT NULL,
	"weaknesses" text DEFAULT '' NOT NULL,
	"improvements" text DEFAULT '' NOT NULL,
	"past_performance_citation" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "proposal_debrief_proposal_id_unique" UNIQUE("proposal_id")
);
--> statement-breakpoint
CREATE TABLE "proposal_outcome" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"outcome_type" "proposal_outcome_type" NOT NULL,
	"award_value" text DEFAULT '' NOT NULL,
	"decision_date" timestamp,
	"reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"lessons_learned" text DEFAULT '' NOT NULL,
	"follow_up_actions" text DEFAULT '' NOT NULL,
	"awarded_to_competitor" text DEFAULT '' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "proposal_outcome_proposal_id_unique" UNIQUE("proposal_id")
);
--> statement-breakpoint
ALTER TABLE "proposal_debrief" ADD CONSTRAINT "proposal_debrief_proposal_id_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_debrief" ADD CONSTRAINT "proposal_debrief_outcome_id_proposal_outcome_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."proposal_outcome"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_debrief" ADD CONSTRAINT "proposal_debrief_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_debrief" ADD CONSTRAINT "proposal_debrief_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_outcome" ADD CONSTRAINT "proposal_outcome_proposal_id_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_outcome" ADD CONSTRAINT "proposal_outcome_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_outcome" ADD CONSTRAINT "proposal_outcome_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;