-- BL-9 Slice 7 — Brain feedback loop from track changes.
--
-- Every accept / reject a section owner makes in the editor's
-- track-changes sidebar is recorded here: what the change was (insert
-- or delete), who authored it, who resolved it, the affected text and
-- whether it was part of a bulk accept-all / reject-all. Two consumers:
--   - the section drafter (src/lib/edit-feedback.ts) summarises the
--     team's recent decisions into preferred / rejected / removed
--     phrasing and hands it to the model as pattern intel, so drafts
--     move toward what owners actually keep;
--   - the proposal's AI Draft Insights panel shows acceptance rates.
-- It also closes the audit gap Slice 3 deferred: the action that writes
-- these rows records an audit_log entry per resolution batch.

CREATE TABLE IF NOT EXISTS "section_change_decision" (
  "id"                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"      uuid        NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "proposal_id"          uuid        NOT NULL REFERENCES "proposal"("id") ON DELETE CASCADE,
  "section_id"           uuid        NOT NULL REFERENCES "proposal_section"("id") ON DELETE CASCADE,
  "section_kind"         text        NOT NULL DEFAULT '',
  "change_id"            text        NOT NULL,
  "change_type"          text        NOT NULL,
  "decision"             text        NOT NULL,
  "bulk"                 boolean     NOT NULL DEFAULT false,
  "author_user_id"       text        NOT NULL DEFAULT '',
  "author_name_snapshot" text        NOT NULL DEFAULT '',
  "decided_by_user_id"   text        NOT NULL,
  "text"                 text        NOT NULL DEFAULT '',
  "word_count"           integer     NOT NULL DEFAULT 0,
  "created_at"           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "scd_org_created_idx"
  ON "section_change_decision" ("organization_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "scd_org_kind_decision_idx"
  ON "section_change_decision" ("organization_id", "section_kind", "decision", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "scd_proposal_idx"
  ON "section_change_decision" ("proposal_id");

CREATE INDEX IF NOT EXISTS "scd_section_idx"
  ON "section_change_decision" ("section_id");
