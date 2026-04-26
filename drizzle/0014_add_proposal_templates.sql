CREATE TABLE "proposal_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp,
	"cover_html" text DEFAULT '' NOT NULL,
	"header_html" text DEFAULT '' NOT NULL,
	"footer_html" text DEFAULT '' NOT NULL,
	"page_css" text DEFAULT '' NOT NULL,
	"section_seed" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"brand_primary" text DEFAULT '#2DD4BF' NOT NULL,
	"brand_accent" text DEFAULT '#EC4899' NOT NULL,
	"font_display" text DEFAULT 'Inter' NOT NULL,
	"font_body" text DEFAULT 'Inter' NOT NULL,
	"logo_url" text DEFAULT '' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proposal" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "proposal_template" ADD CONSTRAINT "proposal_template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_template" ADD CONSTRAINT "proposal_template_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_template_id_proposal_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."proposal_template"("id") ON DELETE set null ON UPDATE no action;