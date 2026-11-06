-- BL-SCOUT-AMEND — the amendment watch. Every open opportunity with a
-- SAM.gov notice is checked daily for new notices of its solicitation
-- and new attachments; each new file is filed on the opportunity and the
-- team is told. The opportunity remembers the attachment links and the
-- notices it has filed, and when it was last checked (and tried), so a
-- check downloads only what is new and the queue rotates. The rules-engine
-- trigger and the inbox kind are added here; the default rule is seeded
-- in 0146 (an INSERT cannot use an enum value added in the same
-- transaction). Idempotent and additive.

ALTER TYPE "notification_trigger_event_kind" ADD VALUE IF NOT EXISTS 'solicitation_amended';--> statement-breakpoint
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'solicitation_amended';--> statement-breakpoint
ALTER TABLE "opportunity" ADD COLUMN IF NOT EXISTS "sam_watch_seen_links" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunity" ADD COLUMN IF NOT EXISTS "sam_watch_notice_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunity" ADD COLUMN IF NOT EXISTS "sam_watch_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "opportunity" ADD COLUMN IF NOT EXISTS "sam_watch_attempted_at" timestamp with time zone;
