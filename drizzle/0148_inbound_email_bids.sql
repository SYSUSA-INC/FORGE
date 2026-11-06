-- BL-SCOUT-INBOX phase 2 — the bids in a portal's email become Scout
-- finds. A durable job reads each email (`inbound_email_parse`); each bid
-- is a find whose source is `portal_email` and that remembers its email,
-- so the email's attachments go with it to the opportunity. Idempotent
-- and additive.

ALTER TYPE "background_job_kind" ADD VALUE IF NOT EXISTS 'inbound_email_parse';--> statement-breakpoint
ALTER TYPE "scout_candidate_source" ADD VALUE IF NOT EXISTS 'portal_email';--> statement-breakpoint
ALTER TABLE "scout_candidate" ADD COLUMN IF NOT EXISTS "inbound_email_id" uuid REFERENCES "inbound_email"("id") ON DELETE SET NULL;
