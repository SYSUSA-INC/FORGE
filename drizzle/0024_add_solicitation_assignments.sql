CREATE TYPE "public"."solicitation_role" AS ENUM('capture_lead', 'proposal_manager', 'technical_lead', 'pricing_lead', 'compliance_reviewer', 'color_team_reviewer', 'subject_matter_expert', 'contributor', 'observer');--> statement-breakpoint
ALTER TYPE "public"."notification_kind" ADD VALUE IF NOT EXISTS 'solicitation_role_assigned';--> statement-breakpoint
CREATE TABLE "solicitation_assignment" (
	"organization_id" uuid NOT NULL,
	"solicitation_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "solicitation_role" NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"assigned_by_user_id" text,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "solicitation_assignment_pk" PRIMARY KEY("solicitation_id","user_id","role")
);
--> statement-breakpoint
ALTER TABLE "solicitation_assignment" ADD CONSTRAINT "solicitation_assignment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitation_assignment" ADD CONSTRAINT "solicitation_assignment_solicitation_id_solicitation_id_fk" FOREIGN KEY ("solicitation_id") REFERENCES "public"."solicitation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitation_assignment" ADD CONSTRAINT "solicitation_assignment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solicitation_assignment" ADD CONSTRAINT "solicitation_assignment_assigned_by_user_id_user_id_fk" FOREIGN KEY ("assigned_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "solicitation_assignment_solicitation_id_idx" ON "solicitation_assignment" ("solicitation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "solicitation_assignment_user_id_idx" ON "solicitation_assignment" ("user_id");
