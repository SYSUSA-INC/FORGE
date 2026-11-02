-- BL-STAB-8b-1 — whether a link went out by email (the inbox proved the address) or was copied.
ALTER TABLE "verificationToken" ADD COLUMN IF NOT EXISTS "sent_by_email" boolean NOT NULL DEFAULT false;--> statement-breakpoint
-- A Google / Microsoft account the provider verified at creation never got FORGE's own stamp: backfill it.
UPDATE "user" u SET "emailVerified" = now() WHERE u."emailVerified" IS NULL AND EXISTS (SELECT 1 FROM "account" a WHERE a."userId" = u.id);
