CREATE TYPE "public"."knowledge_extraction_run_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."knowledge_extraction_decision" AS ENUM('pending', 'approved', 'rejected', 'merged');--> statement-breakpoint
CREATE TABLE "knowledge_extraction_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"status" "knowledge_extraction_run_status" DEFAULT 'queued' NOT NULL,
	"prompt_version" text DEFAULT 'v1' NOT NULL,
	"provider" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	"error_message" text DEFAULT '' NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"started_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_extraction_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"kind" "knowledge_kind" NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_excerpt" text DEFAULT '' NOT NULL,
	"decision" "knowledge_extraction_decision" DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" text,
	"decided_at" timestamp,
	"promoted_entry_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_extraction_run" ADD CONSTRAINT "knowledge_extraction_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_extraction_run" ADD CONSTRAINT "knowledge_extraction_run_artifact_id_knowledge_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."knowledge_artifact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_extraction_run" ADD CONSTRAINT "knowledge_extraction_run_started_by_user_id_user_id_fk" FOREIGN KEY ("started_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_extraction_candidate" ADD CONSTRAINT "knowledge_extraction_candidate_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_extraction_candidate" ADD CONSTRAINT "knowledge_extraction_candidate_run_id_knowledge_extraction_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."knowledge_extraction_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_extraction_candidate" ADD CONSTRAINT "knowledge_extraction_candidate_artifact_id_knowledge_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."knowledge_artifact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_extraction_candidate" ADD CONSTRAINT "knowledge_extraction_candidate_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_extraction_candidate" ADD CONSTRAINT "knowledge_extraction_candidate_promoted_entry_id_knowledge_entry_id_fk" FOREIGN KEY ("promoted_entry_id") REFERENCES "public"."knowledge_entry"("id") ON DELETE set null ON UPDATE no action;
