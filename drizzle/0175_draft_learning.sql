-- BL-NAV-LIFECYCLE 5d-1 — learning how the company writes: what the
-- reviewers change, and how much of the AI's first draft survives each
-- review. Design: docs/design/BL-NAV-LIFECYCLE_PHASE5_DEVELOP.md §2.5.
-- Additive, idempotent.
--
-- The AI draft's own text is kept as a `proposal_section_snapshot` row of
-- kind 'ai_draft' (the column is free text: no schema change for it).

-- A tracked change a colour-team reviewer suggested keeps the round it
-- came from, so the decision on it is known as "accepted at Pink".
ALTER TABLE "section_change_decision"
  ADD COLUMN IF NOT EXISTS "review_id" uuid REFERENCES "proposal_review"("id") ON DELETE SET NULL;
ALTER TABLE "section_change_decision" ADD COLUMN IF NOT EXISTS "review_color" text;
CREATE INDEX IF NOT EXISTS "scd_review_idx"
  ON "section_change_decision" ("review_id")
  WHERE "review_id" IS NOT NULL;

-- One row per (review round, section): the share of the section's AI draft
-- still in its text when the round started. Written once, never updated.
CREATE TABLE IF NOT EXISTS "section_draft_retention" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "proposal_id" uuid NOT NULL REFERENCES "proposal"("id") ON DELETE CASCADE,
  "section_id" uuid NOT NULL REFERENCES "proposal_section"("id") ON DELETE CASCADE,
  "review_id" uuid NOT NULL REFERENCES "proposal_review"("id") ON DELETE CASCADE,
  "review_color" text NOT NULL,
  "section_kind" text NOT NULL DEFAULT '',
  "draft_word_count" integer NOT NULL DEFAULT 0,
  "kept_word_count" integer NOT NULL DEFAULT 0,
  "kept_fraction" real NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "section_draft_retention_review_section_idx"
  ON "section_draft_retention" ("review_id", "section_id");
CREATE INDEX IF NOT EXISTS "section_draft_retention_org_proposal_idx"
  ON "section_draft_retention" ("organization_id", "proposal_id");
