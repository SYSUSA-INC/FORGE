CREATE TYPE "public"."opportunity_review_recommendation" AS ENUM('pending', 'bid', 'no_bid', 'more_info');--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'opportunity_review_completed';--> statement-breakpoint
CREATE TABLE "opportunity_review_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"sender_user_id" text,
	"reviewer_user_id" text,
	"reviewer_email" text NOT NULL,
	"reviewer_name" text DEFAULT '' NOT NULL,
	"token" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"completed_at" timestamp,
	"recommendation" "opportunity_review_recommendation" DEFAULT 'pending' NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_review_request_token_unique" UNIQUE ("token")
);
--> statement-breakpoint
ALTER TABLE "opportunity_review_request" ADD CONSTRAINT "opportunity_review_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_review_request" ADD CONSTRAINT "opportunity_review_request_opportunity_id_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_review_request" ADD CONSTRAINT "opportunity_review_request_sender_user_id_user_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_review_request" ADD CONSTRAINT "opportunity_review_request_reviewer_user_id_user_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
