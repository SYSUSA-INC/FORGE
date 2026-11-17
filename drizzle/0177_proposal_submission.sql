-- BL-NAV-LIFECYCLE 6a — Deliver: the submission record. One row per
-- submission of a proposal (a resubmission after an amendment is a second
-- row): how it was sent, to whom, by whom, when, the files that left (a
-- copy and a SHA-256 of each) and the state of the colour-team sign-off
-- at that moment, with the override reason when the gate was not clear.
-- Design: docs/design/BL-NAV-LIFECYCLE_PHASE6_DELIVER.md §2.1 to §2.3.
-- Additive, idempotent. The columns for sending from the portal (subject,
-- body, the addresses, the Message-ID) are filled from 6b on.
DO $$ BEGIN
  CREATE TYPE "proposal_submission_method" AS ENUM ('portal_email', 'own_email', 'government_portal', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "proposal_submission_status" AS ENUM ('draft', 'sending', 'sent', 'failed', 'recorded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
ALTER TYPE "opportunity_activity_kind" ADD VALUE IF NOT EXISTS 'submission';--> statement-breakpoint
ALTER TYPE "notification_trigger_event_kind" ADD VALUE IF NOT EXISTS 'proposal_submitted';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposal_submission" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "opportunity_id" uuid NOT NULL REFERENCES "opportunity"("id") ON DELETE CASCADE,
  "proposal_id" uuid NOT NULL REFERENCES "proposal"("id") ON DELETE CASCADE,
  "method" "proposal_submission_method" NOT NULL,
  "status" "proposal_submission_status" NOT NULL DEFAULT 'draft',
  "recipients_to" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "recipients_cc" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "subject" text NOT NULL DEFAULT '',
  "body" text NOT NULL DEFAULT '',
  "from_address" text NOT NULL DEFAULT '',
  "reply_address" text NOT NULL DEFAULT '',
  "message_id" text NOT NULL DEFAULT '',
  "note" text NOT NULL DEFAULT '',
  "error" text NOT NULL DEFAULT '',
  "files" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "signoff" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "override_reason" text NOT NULL DEFAULT '',
  "sent_at" timestamp with time zone,
  "sent_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_submission_org_opportunity_idx"
  ON "proposal_submission" ("organization_id", "opportunity_id", "created_at");
