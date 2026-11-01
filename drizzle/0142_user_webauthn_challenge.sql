-- BL-STAB-8a-3 — the one open passkey challenge per user. Idempotent and additive.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "webauthn_challenge" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "webauthn_challenge_at" timestamp;
