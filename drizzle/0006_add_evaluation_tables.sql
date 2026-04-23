CREATE TYPE "public"."opportunity_activity_kind" AS ENUM('note', 'meeting', 'action', 'stage_change', 'gate_decision', 'evaluation_update', 'competitor_update', 'owner_change');--> statement-breakpoint
CREATE TABLE "opportunity_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"user_id" text,
	"kind" "opportunity_activity_kind" DEFAULT 'note' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_competitor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_incumbent" boolean DEFAULT false NOT NULL,
	"past_performance" text DEFAULT '' NOT NULL,
	"strengths" text DEFAULT '' NOT NULL,
	"weaknesses" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_evaluation" (
	"opportunity_id" uuid PRIMARY KEY NOT NULL,
	"strategic_fit" integer DEFAULT 0 NOT NULL,
	"customer_relationship" integer DEFAULT 0 NOT NULL,
	"competitive_posture" integer DEFAULT 0 NOT NULL,
	"resource_availability" integer DEFAULT 0 NOT NULL,
	"financial_attractiveness" integer DEFAULT 0 NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunity_activity" ADD CONSTRAINT "opportunity_activity_opportunity_id_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_activity" ADD CONSTRAINT "opportunity_activity_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_competitor" ADD CONSTRAINT "opportunity_competitor_opportunity_id_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_evaluation" ADD CONSTRAINT "opportunity_evaluation_opportunity_id_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunity"("id") ON DELETE cascade ON UPDATE no action;