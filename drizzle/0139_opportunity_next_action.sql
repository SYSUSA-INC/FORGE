-- BL-NEXT-ACTION phase 5a — the next action FORGE proposes for a pursuit,
-- one open row per opportunity and kind. Idempotent and additive.
CREATE TABLE IF NOT EXISTS "opportunity_next_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"proposal_id" uuid,
	"kind" text NOT NULL,
	"rule" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"href" text DEFAULT '' NOT NULL,
	"priority" text DEFAULT 'this_week' NOT NULL,
	"due_by" timestamp,
	"stage" text DEFAULT '' NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"prepared" jsonb,
	"decided_by_user_id" text,
	"decided_at" timestamp,
	"snoozed_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "opportunity_next_action" ADD CONSTRAINT "opportunity_next_action_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "opportunity_next_action" ADD CONSTRAINT "opportunity_next_action_opportunity_id_opportunity_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunity"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "opportunity_next_action" ADD CONSTRAINT "opportunity_next_action_proposal_id_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "opportunity_next_action" ADD CONSTRAINT "opportunity_next_action_decided_by_user_id_user_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunity_next_action_org_idx" ON "opportunity_next_action" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunity_next_action_org_opp_idx" ON "opportunity_next_action" USING btree ("organization_id", "opportunity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunity_next_action_org_status_idx" ON "opportunity_next_action" USING btree ("organization_id", "status");
