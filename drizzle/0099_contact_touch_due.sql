-- BL-FB-X-CRM Slice 2 — follow-up reminders for customer contacts.
-- The daily cron fires the rules-engine trigger `contact_touch_due` to
-- the contact's relationship owner when the agreed next touch is within
-- a day or overdue, once per agreed date: `touch_reminder_for` stores
-- the next-touch date the reminder was sent for, so a new date re-arms.
-- The default rule is seeded in 0100 (an INSERT cannot reference an enum
-- value added in the same transaction). Idempotent and additive.

ALTER TYPE "notification_trigger_event_kind" ADD VALUE IF NOT EXISTS 'contact_touch_due';--> statement-breakpoint
ALTER TABLE "customer_contact" ADD COLUMN IF NOT EXISTS "touch_reminder_for" timestamp;
