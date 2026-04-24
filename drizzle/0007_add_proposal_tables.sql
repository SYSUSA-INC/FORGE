CREATE TYPE "public"."proposal_section_kind" AS ENUM('executive_summary', 'technical', 'management', 'past_performance', 'pricing', 'compliance');--> statement-breakpoint
CREATE TYPE "public"."proposal_section_status" AS ENUM('not_started', 'in_progress', 'draft_complete', 'in_review', 'approved');--> statement-breakpoint
CREATE TYPE "public"."proposal_stage" AS ENUM('draft', 'pink_team', 'red_team', 'gold_team', 'white_gloves', 'submitted', 'awarded', 'lost', 'no_bid', 'archived');--> statement-breakpoint
CREATE TABLE "proposal_section" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"kind" "proposal_section_kind" NOT NULL,
	"title" text NOT NULL,
	"ordering" integer DEFAULT 0 NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"status" "proposal_section_status" DEFAULT 'not_started' NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"page_limit" integer,
	"author_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"title" text NOT NULL,
	"stage" "proposal_stage" DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp,
	"proposal_manager_user_id" text,
	"capture_manager_user_id" text,
	"pricing_lead_user_id" text,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proposal_section" ADD CONSTRAINT "proposal_section_proposal_id_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_section" ADD CONSTRAINT "proposal_section_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_opportunity_id_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_proposal_manager_user_id_user_id_fk" FOREIGN KEY ("proposal_manager_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_capture_manager_user_id_user_id_fk" FOREIGN KEY ("capture_manager_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_pricing_lead_user_id_user_id_fk" FOREIGN KEY ("pricing_lead_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;