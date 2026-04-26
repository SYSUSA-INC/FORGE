CREATE TYPE "public"."notification_kind" AS ENUM('review_assigned', 'review_section_assigned', 'review_comment_mentioned', 'review_completed');--> statement-breakpoint
CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"recipient_user_id" text NOT NULL,
	"actor_user_id" text,
	"kind" "notification_kind" NOT NULL,
	"subject" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"link_path" text DEFAULT '' NOT NULL,
	"proposal_id" uuid,
	"review_id" uuid,
	"comment_id" uuid,
	"email_sent_at" timestamp,
	"email_error" text DEFAULT '' NOT NULL,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proposal_review_assignment" ADD COLUMN "section_id" uuid;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_recipient_user_id_user_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_proposal_id_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_review_id_proposal_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."proposal_review"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_comment_id_proposal_review_comment_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."proposal_review_comment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_review_assignment" ADD CONSTRAINT "proposal_review_assignment_section_id_proposal_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."proposal_section"("id") ON DELETE set null ON UPDATE no action;