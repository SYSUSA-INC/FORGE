-- BL-CAP-MATRIX phase A — the capability matrix questionnaire, one row per
-- opportunity; questions and answers as JSON.
CREATE TABLE "opportunity_capability_matrix" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"parse_version" text DEFAULT '' NOT NULL,
	"questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"built_by_user_id" text,
	"built_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunity_capability_matrix" ADD CONSTRAINT "opportunity_capability_matrix_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_capability_matrix" ADD CONSTRAINT "opportunity_capability_matrix_opportunity_id_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunity"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_capability_matrix" ADD CONSTRAINT "opportunity_capability_matrix_built_by_user_id_user_id_fk" FOREIGN KEY ("built_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opportunity_capability_matrix_org_idx" ON "opportunity_capability_matrix" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_capability_matrix_opp_uidx" ON "opportunity_capability_matrix" USING btree ("opportunity_id");
