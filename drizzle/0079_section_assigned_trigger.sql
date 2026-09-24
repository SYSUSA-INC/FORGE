-- BL-AIP-3 — new rules-engine trigger kind `proposal_section_assigned`.
--
-- Fired by saveSectionAction when a proposal section's author changes
-- to a different (non-null) user than before. The rules engine maps it
-- onto the existing `review_section_assigned` inbox kind so the bell,
-- filters and legacy inbox need no changes.
--
-- The seeded default rule lives in 0080 because Postgres won't let an
-- INSERT in the same transaction reference an enum value ADDed in that
-- same transaction.
--
-- Idempotent: ADD VALUE IF NOT EXISTS.

ALTER TYPE "notification_trigger_event_kind" ADD VALUE IF NOT EXISTS 'proposal_section_assigned';
