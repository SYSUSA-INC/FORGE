-- BL-COMPANY-MODEL phase 1a — FORGE's own account of what the company
-- does: one row per organization with the draft and the approved body,
-- and a version row per approval. A draft never counts; readers use the
-- approved body only. Idempotent and additive.
CREATE TABLE IF NOT EXISTS "organization_model" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"draft" jsonb,
	"draft_sources" jsonb,
	"draft_generated_at" timestamp,
	"draft_model" text DEFAULT '' NOT NULL,
	"draft_prompt_version" text DEFAULT '' NOT NULL,
	"draft_edited_by_user_id" text,
	"approved" jsonb,
	"approved_sources" jsonb,
	"approved_version" integer DEFAULT 0 NOT NULL,
	"approved_by_user_id" text,
	"approved_at" timestamp,
	"stale_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_model" ADD CONSTRAINT "organization_model_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_model" ADD CONSTRAINT "organization_model_draft_edited_by_user_id_user_id_fk" FOREIGN KEY ("draft_edited_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_model" ADD CONSTRAINT "organization_model_approved_by_user_id_user_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_model_org_idx" ON "organization_model" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_model_org_uidx" ON "organization_model" USING btree ("organization_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organization_model_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"body" jsonb NOT NULL,
	"sources" jsonb,
	"approved_by_user_id" text,
	"approved_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_model_version" ADD CONSTRAINT "organization_model_version_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_model_version" ADD CONSTRAINT "organization_model_version_approved_by_user_id_user_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_model_version_org_idx" ON "organization_model_version" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organization_model_version_org_version_uidx" ON "organization_model_version" USING btree ("organization_id", "version");
