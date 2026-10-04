-- BL-FB-CHAT-MULTI Slice 3 — who has a section open.
--
-- One row per (organization, section, member) with when that member's
-- open section last checked in. The section page checks in every 30
-- seconds while the section is open and removes the row when it closes;
-- anyone seen in the last 75 seconds counts as "here". Rows older than
-- ten minutes are swept on the next check-in for that section. Works on
-- serverless hosting without the Hocuspocus layer. Idempotent, additive.

CREATE TABLE IF NOT EXISTS "section_presence" (
  "organization_id"  uuid       NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "section_id"       uuid       NOT NULL REFERENCES "proposal_section"("id") ON DELETE CASCADE,
  "user_id"          text       NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "last_seen_at"     timestamp  NOT NULL DEFAULT now(),
  PRIMARY KEY ("organization_id", "section_id", "user_id")
);
