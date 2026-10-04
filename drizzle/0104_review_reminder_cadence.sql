-- BL-FB-X-COLOR-TEAM Slice 3 — reminder cadence for review rounds, per
-- tenant: how many days before a round's due date the reviewers without
-- a verdict are first reminded (0 = on the day), and every how many days
-- again while the round is overdue (0 = once only, the Slice 2 behaviour).
-- Edited by org admins under Settings → Review reminders.
-- Idempotent and additive.

ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "review_reminder_days_before" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "review_reminder_repeat_days" integer NOT NULL DEFAULT 0;
