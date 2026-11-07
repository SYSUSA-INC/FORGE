-- BL-NAV-LIFECYCLE phase 3c (FORGE II C-5, C-6) — a partner's personal
-- emailed link to the capability matrix questions (no account, 14 days,
-- only the token's hash kept), and the partner's own answers and
-- certifications on its opportunity_partner row. Idempotent and additive.

ALTER TABLE "opportunity_partner" ADD COLUMN IF NOT EXISTS "partner_answers" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunity_partner" ADD COLUMN IF NOT EXISTS "certifications" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunity_partner" ADD COLUMN IF NOT EXISTS "answered_at" timestamp with time zone;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "opportunity_partner_invite" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "opportunity_id" uuid NOT NULL REFERENCES "opportunity"("id") ON DELETE CASCADE,
  "partner_id" uuid NOT NULL REFERENCES "opportunity_partner"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "contact_name" text DEFAULT '' NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "emailed_at" timestamp with time zone,
  "opened_at" timestamp with time zone,
  "submitted_at" timestamp with time zone,
  "created_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "opportunity_partner_invite_token_uq" ON "opportunity_partner_invite" ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunity_partner_invite_partner_idx" ON "opportunity_partner_invite" ("partner_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "opportunity_partner_invite_org_idx" ON "opportunity_partner_invite" ("organization_id", "created_at");
