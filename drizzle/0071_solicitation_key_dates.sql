-- BL-FB-SOL-CALENDAR — key-date timeline + T-7/T-3/T-1 reminders.
--
-- Adds key_dates JSONB to solicitations to store AI-extracted milestones
-- (Q&A cutoff, site visit, oral presentations, expected award, etc.)
-- beyond the single responseDueDate field already present.
-- The daily cron reads this column and dispatches in-app notifications
-- to solicitation team members at T-7, T-3, and T-1 days before each date.

ALTER TABLE "solicitation"
  ADD COLUMN "key_dates" jsonb NOT NULL DEFAULT '[]';
