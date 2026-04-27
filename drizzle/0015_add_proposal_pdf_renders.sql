CREATE TABLE "proposal_pdf_render" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"template_id" uuid,
	"rendered_by_user_id" text,
	"storage_path" text NOT NULL,
	"content_type" text DEFAULT 'pdf' NOT NULL,
	"byte_size" integer DEFAULT 0 NOT NULL,
	"page_count" integer DEFAULT 0 NOT NULL,
	"provider" text DEFAULT 'stub' NOT NULL,
	"download_url" text DEFAULT '' NOT NULL,
	"expires_at" timestamp,
	"rendered_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proposal_pdf_render" ADD CONSTRAINT "proposal_pdf_render_proposal_id_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_pdf_render" ADD CONSTRAINT "proposal_pdf_render_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_pdf_render" ADD CONSTRAINT "proposal_pdf_render_template_id_proposal_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."proposal_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_pdf_render" ADD CONSTRAINT "proposal_pdf_render_rendered_by_user_id_user_id_fk" FOREIGN KEY ("rendered_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_template_id_proposal_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."proposal_template"("id") ON DELETE set null ON UPDATE no action;