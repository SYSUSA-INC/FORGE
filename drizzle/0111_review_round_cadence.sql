-- BL-FB-X-COLOR-TEAM Slice 4 — a review round's own reminder cadence.
--
-- NULL (the default) follows the tenant's cadence (organization
-- .review_reminder_days_before / _repeat_days, 0104). Set together, they
-- override it for this round only. Idempotent, additive.

ALTER TABLE "proposal_review" ADD COLUMN IF NOT EXISTS "reminder_days_before" integer;--> statement-breakpoint
ALTER TABLE "proposal_review" ADD COLUMN IF NOT EXISTS "reminder_repeat_days" integer;
