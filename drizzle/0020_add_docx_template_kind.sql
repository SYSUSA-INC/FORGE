CREATE TYPE "public"."proposal_template_kind" AS ENUM('html', 'docx');--> statement-breakpoint
ALTER TABLE "proposal_template" ADD COLUMN "kind" "proposal_template_kind" DEFAULT 'html' NOT NULL;--> statement-breakpoint
ALTER TABLE "proposal_template" ADD COLUMN "docx_storage_path" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "proposal_template" ADD COLUMN "docx_file_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "proposal_template" ADD COLUMN "docx_file_size" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "proposal_template" ADD COLUMN "docx_uploaded_at" timestamp;--> statement-breakpoint
ALTER TABLE "proposal_template" ADD COLUMN "variables_detected" jsonb DEFAULT '[]'::jsonb NOT NULL;
