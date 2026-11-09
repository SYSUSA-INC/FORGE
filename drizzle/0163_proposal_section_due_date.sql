-- BL-NAV-LIFECYCLE 4b-2 — a due date per proposal section, set on the opportunity's Plan tab beside the section's owner (P-4), and the inbox kind for proposal_section_overdue, the trigger the daily cron now fires for a section past its date with no draft (the default rule follows in 0164: an INSERT cannot reference an enum value added in the same transaction).
ALTER TABLE "proposal_section" ADD COLUMN IF NOT EXISTS "due_date" date;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_section_due_date_idx" ON "proposal_section" ("due_date");--> statement-breakpoint
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'proposal_section_overdue';
