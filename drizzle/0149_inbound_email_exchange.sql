-- BL-SCOUT-INBOX — mail arrives through FORGE's Exchange mailbox
-- (Microsoft Graph), not Postmark (owner, 2026-11-06). The provider's
-- default follows. Idempotent.
ALTER TABLE "inbound_email" ALTER COLUMN "provider" SET DEFAULT 'exchange';
