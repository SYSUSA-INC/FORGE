-- BL-9 Slice 5b — version snapshots for proposal sections.
--
-- A snapshot captures the projected ProseMirror JSON (body_doc) at a
-- point in time, with author attribution + a label + kind (manual vs
-- automatic stage-transition checkpoint). Snapshots live forever
-- alongside the section; they cascade-delete when the section or
-- proposal or organization goes away.
--
-- organization_id is denormalized from proposal_section.proposal.
-- organization_id so the static isolation checker treats this table as
-- tenant-scoped and so per-tenant queries don't need a 3-way join.

CREATE TABLE "proposal_section_snapshot" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL
    REFERENCES "organization"("id") ON DELETE CASCADE,
  "proposal_section_id" uuid NOT NULL
    REFERENCES "proposal_section"("id") ON DELETE CASCADE,
  "proposal_id" uuid NOT NULL
    REFERENCES "proposal"("id") ON DELETE CASCADE,
  "kind" text NOT NULL DEFAULT 'manual',
  "label" text NOT NULL DEFAULT '',
  "body_doc" jsonb NOT NULL DEFAULT '{"type":"doc","content":[]}'::jsonb,
  "word_count" integer NOT NULL DEFAULT 0,
  "created_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_by_name_snapshot" text NOT NULL DEFAULT '',
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- Per-section list ordered by creation time (newest first) is the hot path.
CREATE INDEX "proposal_section_snapshot_section_id_idx"
  ON "proposal_section_snapshot" ("proposal_section_id", "created_at" DESC);

-- Per-tenant queries (e.g. "show all snapshots created today across this org")
-- benefit from an org-scoped index covering the recency dimension.
CREATE INDEX "proposal_section_snapshot_org_id_idx"
  ON "proposal_section_snapshot" ("organization_id", "created_at" DESC);
