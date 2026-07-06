-- BL-11 — Brain self-improvement loop: section draft signal table
--
-- Captures every AI-generated draft (mode=draft) at generation time,
-- then records how much of it survived when the user saves the section.
-- The resulting `accepted_fraction` (0–1) measures AI draft quality:
-- 1.0 = user kept everything, 0.0 = user replaced everything.
--
-- A/B comparisons: two signal rows sharing the same `ab_pair_id` with
-- `ab_variant = 'a'` and `'b'`. `selected = true` marks the variant the
-- user accepted; `selected = false` marks the one they discarded.

CREATE TABLE "section_draft_signal" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"     uuid        NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "proposal_id"         uuid        NOT NULL REFERENCES "proposal"("id") ON DELETE CASCADE,
  "section_id"          uuid        NOT NULL REFERENCES "proposal_section"("id") ON DELETE CASCADE,
  "created_by_user_id"  text        NOT NULL,
  "mode"                text        NOT NULL DEFAULT 'draft',
  "section_kind"        text        NOT NULL DEFAULT '',
  "draft_text"          text        NOT NULL,
  "draft_word_count"    integer     NOT NULL DEFAULT 0,
  "accepted_word_count" integer,
  "accepted_fraction"   real,
  "stubbed"             boolean     NOT NULL DEFAULT false,
  "ab_pair_id"          uuid,
  "ab_variant"          text,
  "selected"            boolean,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "resolved_at"         timestamptz
);

CREATE INDEX "sds_org_created_idx"
  ON "section_draft_signal" ("organization_id", "created_at" DESC);

CREATE INDEX "sds_section_idx"
  ON "section_draft_signal" ("section_id");
