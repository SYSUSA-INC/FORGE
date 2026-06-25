-- BL-FB-SOL-AMEND-DIFF — amendment relationship between solicitations
--
-- A solicitation can have N amendment children. The child carries
-- `parent_solicitation_id` pointing at the original solicitation, and
-- `amendment_number` (free-text — "0001", "A-1", "Mod 3", whatever the
-- contracting office stamps).
--
-- When the parent is deleted, amendments cascade — the relationship is
-- the only context that gives an amendment meaning.

ALTER TABLE "solicitation"
  ADD COLUMN "parent_solicitation_id" uuid
    REFERENCES "solicitation"("id") ON DELETE CASCADE;

ALTER TABLE "solicitation"
  ADD COLUMN "amendment_number" text NOT NULL DEFAULT '';

CREATE INDEX "solicitation_parent_idx"
  ON "solicitation" ("parent_solicitation_id");
