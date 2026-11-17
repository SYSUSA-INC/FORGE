-- BL-NAV-LIFECYCLE 6d-1 — Reply from the portal (FORGE II S-4,
-- Answering). An answer to a reply is kept as a proposal_submission row
-- of method portal_email that names the inbound message it answers. A
-- row with in_reply_to_email_id set is a reply, never a submission: it
-- carries no proposal file, passes no sign-off gate and moves no stage.
-- The row goes with the message it answers (an inbound email is only
-- removed with its tenant), so a reply can never be left looking like a
-- submission. Additive, idempotent.
-- Design: docs/design/BL-NAV-LIFECYCLE_PHASE6_DELIVER.md §2.5.
ALTER TABLE "proposal_submission" ADD COLUMN IF NOT EXISTS "in_reply_to_email_id" uuid REFERENCES "inbound_email"("id") ON DELETE CASCADE;
