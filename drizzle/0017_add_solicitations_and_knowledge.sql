CREATE TYPE "public"."knowledge_kind" AS ENUM('capability', 'past_performance', 'personnel', 'boilerplate');--> statement-breakpoint
CREATE TYPE "public"."solicitation_parse_status" AS ENUM('uploaded', 'parsing', 'parsed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."solicitation_type" AS ENUM('rfp', 'rfi', 'rfq', 'sources_sought', 'other');--> statement-breakpoint
CREATE TABLE "knowledge_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" "knowledge_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reuse_count" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "solicitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"agency" text DEFAULT '' NOT NULL,
	"office" text DEFAULT '' NOT NULL,
	"type" "solicitation_type" DEFAULT 'other' NOT NULL,
	"solicitation_number" text DEFAULT '' NOT NULL,
	"notice_id" text DEFAULT '' NOT NULL,
	"naics_code" text DEFAULT '' NOT NULL,
	"set_aside" text DEFAULT '' NOT NULL,
	"response_due_date" timestamp,
	"posted_date" timestamp,
	"source" text DEFAULT 'uploaded' NOT NULL,
	"file_name" text DEFAULT '' NOT NULL,
	"file_size" integer DEFAULT 0 NOT NULL,
	"content_type" text DEFAULT '' NOT NULL,
	"storage_path" text DEFAULT '' NOT NULL,
	"parse_status" "solicitation_parse_status" DEFAULT 'uploaded' NOT NULL,
	"parse_error" text DEFAULT '' NOT NULL,
	"raw_text" text DEFAULT '' NOT NULL,
	"section_l_summary" text DEFAULT '' NOT NULL,
	"section_m_summary" text DEFAULT '' NOT NULL,
	"extracted_requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"opportunity_id" uuid,
	"uploaded_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_entry" ADD CONSTRAINT "knowledge_entry_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_entry" ADD CONSTRAINT "knowledge_entry_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitation" ADD CONSTRAINT "solicitation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitation" ADD CONSTRAINT "solicitation_opportunity_id_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunity"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitation" ADD CONSTRAINT "solicitation_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;