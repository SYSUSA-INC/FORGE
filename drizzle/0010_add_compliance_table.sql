CREATE TYPE "public"."compliance_category" AS ENUM('section_l', 'section_m', 'section_c', 'far_clause', 'other');--> statement-breakpoint
CREATE TYPE "public"."compliance_status" AS ENUM('not_addressed', 'partial', 'complete', 'not_applicable');--> statement-breakpoint
CREATE TABLE "compliance_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"category" "compliance_category" DEFAULT 'section_l' NOT NULL,
	"number" text DEFAULT '' NOT NULL,
	"requirement_text" text NOT NULL,
	"volume" text DEFAULT '' NOT NULL,
	"rfp_page_reference" text DEFAULT '' NOT NULL,
	"proposal_section_id" uuid,
	"proposal_page_reference" text DEFAULT '' NOT NULL,
	"status" "compliance_status" DEFAULT 'not_addressed' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"ordering" integer DEFAULT 0 NOT NULL,
	"owner_user_id" text,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "compliance_item" ADD CONSTRAINT "compliance_item_proposal_id_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_item" ADD CONSTRAINT "compliance_item_proposal_section_id_proposal_section_id_fk" FOREIGN KEY ("proposal_section_id") REFERENCES "public"."proposal_section"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_item" ADD CONSTRAINT "compliance_item_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_item" ADD CONSTRAINT "compliance_item_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;