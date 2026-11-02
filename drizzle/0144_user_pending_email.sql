-- BL-STAB-8b-3 — a change of address waiting for the new inbox's confirmation. Idempotent and additive.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "pending_email" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "pending_email_at" timestamp;
