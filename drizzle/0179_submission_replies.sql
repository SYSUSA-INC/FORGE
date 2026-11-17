-- BL-NAV-LIFECYCLE 6c — replies to a submission come back and are filed
-- (FORGE II S-4). A message to an opportunity's own address
-- (sub-…@INBOUND_EMAIL_DOMAIN, drizzle/0178) is kept as an inbound email
-- of kind proposal_reply, tied to the opportunity and to the submission
-- it answers; a job reads its type and a short summary onto the row and
-- files it as a `correspondence` activity, with a notification event.
-- Additive, idempotent. The new enum values are only added here, never
-- used: a statement cannot use a value added in its own transaction.
-- Design: docs/design/BL-NAV-LIFECYCLE_PHASE6_DELIVER.md §2.5.
ALTER TYPE "inbound_email_kind" ADD VALUE IF NOT EXISTS 'proposal_reply';--> statement-breakpoint
ALTER TYPE "opportunity_activity_kind" ADD VALUE IF NOT EXISTS 'correspondence';--> statement-breakpoint
ALTER TYPE "notification_trigger_event_kind" ADD VALUE IF NOT EXISTS 'submission_reply_received';--> statement-breakpoint
ALTER TYPE "background_job_kind" ADD VALUE IF NOT EXISTS 'submission_reply_parse';--> statement-breakpoint
ALTER TABLE "inbound_email" ADD COLUMN IF NOT EXISTS "opportunity_id" uuid REFERENCES "opportunity"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "inbound_email" ADD COLUMN IF NOT EXISTS "submission_id" uuid REFERENCES "proposal_submission"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "inbound_email" ADD COLUMN IF NOT EXISTS "reply_type" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "inbound_email" ADD COLUMN IF NOT EXISTS "reply_summary" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "inbound_email" ADD COLUMN IF NOT EXISTS "reply_date" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "inbound_email" ADD COLUMN IF NOT EXISTS "check_sender" boolean NOT NULL DEFAULT false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_email_org_opportunity_idx"
  ON "inbound_email" ("organization_id", "opportunity_id", "received_at");
