-- BL-MFA-RECOVERY — no lockout from a domain change or one lost method.
-- Each passkey remembers the domain it was made on (a passkey works only
-- there), and a person who can use neither their passkey nor their app
-- can email themselves a single-use recovery link: its hash and expiry
-- live on the user row, with when the last one was sent (one a day).
-- Idempotent and additive.

ALTER TABLE "user_mfa_factor" ADD COLUMN IF NOT EXISTS "rp_id" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "mfa_recovery_token_hash" text;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "mfa_recovery_expires_at" timestamp;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "mfa_recovery_sent_at" timestamp;
