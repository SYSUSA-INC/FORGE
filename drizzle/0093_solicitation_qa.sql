-- BL-FB-SOL-QA — contracting-officer Q&A on a solicitation.
--
-- Agencies answer industry questions as a "Questions and Answers"
-- attachment on the SAM.gov notice, inside the notice description, or
-- by email the team pastes in. Each answer is stored once per
-- solicitation (dedupe key over the normalised pair), with the
-- requirement references it refines; the compliance row it refines is
-- flagged through compliance_item.amended_by_qa_id. The solicitation
-- remembers when its notice was last checked and which attachment
-- links were already read. Every Q&A row carries organization_id.
-- Idempotent and additive.

CREATE TABLE IF NOT EXISTS "solicitation_qa" (
  "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"  uuid        NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "solicitation_id"  uuid        NOT NULL REFERENCES "solicitation"("id") ON DELETE CASCADE,
  "source"           text        NOT NULL DEFAULT 'manual',
  "source_ref"       text        NOT NULL DEFAULT '',
  "ordinal"          integer     NOT NULL DEFAULT 0,
  "question"         text        NOT NULL DEFAULT '',
  "answer"           text        NOT NULL,
  "affected_refs"    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  "dedupe_key"       text        NOT NULL DEFAULT '',
  "posted_at"        timestamptz,
  "added_by_user_id" text        REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at"       timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "solicitation_qa_org_solicitation_idx" ON "solicitation_qa" ("organization_id", "solicitation_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "solicitation_qa_dedupe_idx" ON "solicitation_qa" ("solicitation_id", "dedupe_key");--> statement-breakpoint
ALTER TABLE "solicitation" ADD COLUMN IF NOT EXISTS "qa_checked_at" timestamptz;--> statement-breakpoint
ALTER TABLE "solicitation" ADD COLUMN IF NOT EXISTS "qa_seen_links" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "compliance_item" ADD COLUMN IF NOT EXISTS "amended_by_qa_id" uuid REFERENCES "solicitation_qa"("id") ON DELETE SET NULL;
