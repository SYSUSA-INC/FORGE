CREATE TYPE "public"."knowledge_artifact_kind" AS ENUM('proposal', 'rfp', 'contract', 'cpars', 'debrief', 'capability_brief', 'resume', 'brochure', 'whitepaper', 'email', 'note', 'image', 'spreadsheet', 'deck', 'other');--> statement-breakpoint
CREATE TYPE "public"."knowledge_artifact_source" AS ENUM('uploaded', 'mined_from_proposal', 'inbound_email', 'imported');--> statement-breakpoint
CREATE TYPE "public"."knowledge_artifact_status" AS ENUM('uploaded', 'extracting_text', 'indexed', 'failed');--> statement-breakpoint
CREATE TABLE "knowledge_artifact" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "knowledge_artifact_kind" DEFAULT 'other' NOT NULL,
	"source" "knowledge_artifact_source" DEFAULT 'uploaded' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"file_name" text DEFAULT '' NOT NULL,
	"file_size" integer DEFAULT 0 NOT NULL,
	"content_type" text DEFAULT '' NOT NULL,
	"storage_path" text DEFAULT '' NOT NULL,
	"raw_text" text DEFAULT '' NOT NULL,
	"status" "knowledge_artifact_status" DEFAULT 'uploaded' NOT NULL,
	"status_error" text DEFAULT '' NOT NULL,
	"indexed_at" timestamp,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"uploaded_by_user_id" text,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_artifact" ADD CONSTRAINT "knowledge_artifact_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_artifact" ADD CONSTRAINT "knowledge_artifact_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
