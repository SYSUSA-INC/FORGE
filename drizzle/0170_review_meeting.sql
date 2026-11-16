-- BL-NAV-LIFECYCLE 5c — a review round's meeting: the link the lead pastes (Teams, Zoom, Webex; FORGE creates no meeting), its start time, when the calendar invites went out, and when the day-before reminder went. All nullable; no backfill.
ALTER TABLE "proposal_review"
  ADD COLUMN IF NOT EXISTS "meeting_url" text,
  ADD COLUMN IF NOT EXISTS "meeting_at" timestamp,
  ADD COLUMN IF NOT EXISTS "meeting_invites_sent_at" timestamp,
  ADD COLUMN IF NOT EXISTS "meeting_reminder_sent_at" timestamp;
