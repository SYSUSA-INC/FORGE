-- BL-FB-X-COLOR-TEAM Slice 2 — what follows a review round: open
-- comments carried into the next colour's round (lineage on both the
-- round and the comment), the AI summary of the consolidated report
-- stored on the round, and a once-only reviewer reminder before the due
-- date fired through the rules engine as `review_due_soon` (the default
-- rule is seeded in 0096 — an INSERT cannot reference an enum value
-- added in the same transaction). Idempotent and additive.

ALTER TYPE "notification_trigger_event_kind" ADD VALUE IF NOT EXISTS 'review_due_soon';--> statement-breakpoint
ALTER TABLE "proposal_review" ADD COLUMN IF NOT EXISTS "carried_from_review_id" uuid REFERENCES "proposal_review"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "proposal_review" ADD COLUMN IF NOT EXISTS "ai_summary" jsonb;--> statement-breakpoint
ALTER TABLE "proposal_review" ADD COLUMN IF NOT EXISTS "ai_summary_at" timestamp;--> statement-breakpoint
ALTER TABLE "proposal_review" ADD COLUMN IF NOT EXISTS "due_reminder_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "proposal_review_comment" ADD COLUMN IF NOT EXISTS "carried_from_comment_id" uuid REFERENCES "proposal_review_comment"("id") ON DELETE SET NULL;
