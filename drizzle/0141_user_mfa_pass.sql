-- BL-STAB-8a-2 — the server-side mark that a pending session passed the
-- second step, keyed by the session's pending id. Idempotent and additive.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "mfa_pass_pid" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "mfa_pass_at" timestamp;
