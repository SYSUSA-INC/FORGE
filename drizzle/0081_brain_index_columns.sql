-- BL-AIP-4 — bookkeeping columns for the background scan retry policy
-- and for recording which embedding provider / model produced each
-- knowledge_entry vector (so the brain-index cron can find stub or
-- stale vectors and re-embed them once a live provider is configured).
--
-- Idempotent and additive.

ALTER TABLE "proposal" ADD COLUMN IF NOT EXISTS "scan_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "proposal" ADD COLUMN IF NOT EXISTS "scan_next_attempt_at" timestamp;--> statement-breakpoint
ALTER TABLE "knowledge_entry" ADD COLUMN IF NOT EXISTS "embedding_provider" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_entry" ADD COLUMN IF NOT EXISTS "embedding_model" text DEFAULT '' NOT NULL;
