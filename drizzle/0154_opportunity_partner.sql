-- BL-NAV-LIFECYCLE phase 3a (FORGE II footnote 6, C-1, C-11) — the
-- partners being considered for an opportunity in Capture: each a company
-- of the organization, with where it came from, why it fits, and where it
-- stands (candidate, invited, answered, chosen, declined). Choosing one
-- lets a PARTNER opportunity move to Plan. Idempotent and additive.

DO $$ BEGIN
  CREATE TYPE "opportunity_partner_status" AS ENUM ('candidate', 'invited', 'answered', 'chosen', 'declined');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "opportunity_partner" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "opportunity_id" uuid NOT NULL REFERENCES "opportunity"("id") ON DELETE CASCADE,
  "company_id" uuid NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "source" text DEFAULT 'own' NOT NULL,
  "status" "opportunity_partner_status" DEFAULT 'candidate' NOT NULL,
  "reason" text DEFAULT '' NOT NULL,
  "chosen_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "chosen_at" timestamp with time zone,
  "created_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunity_partner_org_idx" ON "opportunity_partner" ("organization_id", "created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "opportunity_partner_opp_company_uq" ON "opportunity_partner" ("opportunity_id", "company_id");
