CREATE TYPE "public"."opportunity_stage" AS ENUM('identified', 'sources_sought', 'qualification', 'capture', 'pre_proposal', 'writing', 'submitted', 'won', 'lost', 'no_bid');--> statement-breakpoint
CREATE TABLE "opportunity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"agency" text DEFAULT '' NOT NULL,
	"office" text DEFAULT '' NOT NULL,
	"stage" "opportunity_stage" DEFAULT 'identified' NOT NULL,
	"solicitation_number" text DEFAULT '' NOT NULL,
	"notice_id" text DEFAULT '' NOT NULL,
	"value_low" text DEFAULT '' NOT NULL,
	"value_high" text DEFAULT '' NOT NULL,
	"release_date" timestamp,
	"response_due_date" timestamp,
	"award_date" timestamp,
	"naics_code" text DEFAULT '' NOT NULL,
	"psc_code" text DEFAULT '' NOT NULL,
	"set_aside" text DEFAULT '' NOT NULL,
	"contract_type" text DEFAULT '' NOT NULL,
	"place_of_performance" text DEFAULT '' NOT NULL,
	"incumbent" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"p_win" integer DEFAULT 0 NOT NULL,
	"owner_user_id" text,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity" ADD CONSTRAINT "opportunity_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;