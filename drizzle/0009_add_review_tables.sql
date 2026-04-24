CREATE TYPE "public"."review_color" AS ENUM('pink', 'red', 'gold', 'white_gloves');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('scheduled', 'in_progress', 'complete', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."review_verdict" AS ENUM('pass', 'conditional', 'fail');--> statement-breakpoint
CREATE TABLE "proposal_review_assignment" (
	"review_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"verdict" "review_verdict",
	"summary" text DEFAULT '' NOT NULL,
	"submitted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "proposal_review_assignment_review_id_user_id_pk" PRIMARY KEY("review_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "proposal_review_comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"section_id" uuid,
	"user_id" text,
	"body" text NOT NULL,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"color" "review_color" NOT NULL,
	"status" "review_status" DEFAULT 'scheduled' NOT NULL,
	"verdict" "review_verdict",
	"summary" text DEFAULT '' NOT NULL,
	"due_date" timestamp,
	"started_by_user_id" text,
	"started_at" timestamp,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proposal_review_assignment" ADD CONSTRAINT "proposal_review_assignment_review_id_proposal_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."proposal_review"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_review_assignment" ADD CONSTRAINT "proposal_review_assignment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_review_comment" ADD CONSTRAINT "proposal_review_comment_review_id_proposal_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."proposal_review"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_review_comment" ADD CONSTRAINT "proposal_review_comment_section_id_proposal_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."proposal_section"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_review_comment" ADD CONSTRAINT "proposal_review_comment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_review" ADD CONSTRAINT "proposal_review_proposal_id_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_review" ADD CONSTRAINT "proposal_review_started_by_user_id_user_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;