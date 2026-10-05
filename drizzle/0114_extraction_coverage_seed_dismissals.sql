-- BL-AIX Phase 0d — tell teams what the requirement sweep didn't read,
-- and stop a re-seed from bringing back rows they deleted.
--
-- extraction_coverage: how much of the document the windows covered,
-- windows that failed, requirements found vs kept, or a scanned-document
-- marker. Empty for documents parsed before this migration.
--
-- compliance_seed_dismissal: requirement text removed from a proposal's
-- compliance matrix; "Seed from solicitation" skips it. Idempotent,
-- additive.

ALTER TABLE "solicitation" ADD COLUMN IF NOT EXISTS "extraction_coverage" jsonb NOT NULL DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "solicitation_document" ADD COLUMN IF NOT EXISTS "extraction_coverage" jsonb NOT NULL DEFAULT '{}'::jsonb;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "compliance_seed_dismissal" (
  "organization_id"       uuid        NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "proposal_id"           uuid        NOT NULL REFERENCES "proposal"("id") ON DELETE CASCADE,
  "requirement_key"       text        NOT NULL,
  "requirement_text"      text        NOT NULL DEFAULT '',
  "dismissed_by_user_id"  text        REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("proposal_id", "requirement_key")
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "compliance_seed_dismissal_org_idx" ON "compliance_seed_dismissal" ("organization_id", "proposal_id");
