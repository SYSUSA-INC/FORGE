-- BL-AIX Phase 2c — a person's verdict on an extracted requirement.
--
-- requirement_correction: one row per requirement the team confirmed,
-- edited, rejected or added on a solicitation. It is keyed by the wording
-- intake produced (original_key), so the verdict is re-applied when the
-- document is parsed again; doc_key is '' for the solicitation's own
-- clauses, else the companion document's id. original / corrected keep
-- both versions as labelled data for this organization only. One row per
-- (organization, solicitation, document, original wording); a new
-- verdict replaces the old. Tenant-scoped; idempotent, additive.

CREATE TABLE IF NOT EXISTS "requirement_correction" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "solicitation_id" uuid NOT NULL,
  "doc_key" text DEFAULT '' NOT NULL,
  "original_key" text NOT NULL,
  "action" text NOT NULL,
  "original" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "corrected" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "prompt_version" text DEFAULT '' NOT NULL,
  "user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "requirement_correction" ADD CONSTRAINT "requirement_correction_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "requirement_correction" ADD CONSTRAINT "requirement_correction_solicitation_id_solicitation_id_fk" FOREIGN KEY ("solicitation_id") REFERENCES "public"."solicitation"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "requirement_correction" ADD CONSTRAINT "requirement_correction_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "requirement_correction_org_sol_doc_key_idx" ON "requirement_correction" USING btree ("organization_id", "solicitation_id", "doc_key", "original_key");
