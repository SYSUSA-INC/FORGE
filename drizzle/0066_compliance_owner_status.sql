-- BL-FB-CM-OWNERS — per-row owner status on compliance items.
-- Tracks the progress of the assigned owner (unassigned → assigned →
-- in_progress → complete | blocked).  Kept separate from the compliance
-- *item* status (not_addressed → addressed, etc.) so the two axes don't
-- conflate "does the proposal address this requirement" with "has the
-- owner finished their work on it".

CREATE TYPE "compliance_owner_status" AS ENUM (
  'unassigned',
  'assigned',
  'in_progress',
  'complete',
  'blocked'
);

ALTER TABLE "compliance_item"
  ADD COLUMN "owner_status" "compliance_owner_status" NOT NULL DEFAULT 'unassigned';
