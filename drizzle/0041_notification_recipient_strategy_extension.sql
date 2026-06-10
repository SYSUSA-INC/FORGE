-- BL-13 Phase E-2b-2a — extend `notification_recipient_strategy`
-- with `mentioned_in_payload`. The new strategy reads
-- `payload.mentionedUserIds` (filtered to current active members of
-- the tenant) and is used by the upcoming `comment_mentioned` default
-- seed rule so the rules engine can preserve the legacy
-- per-mention fan-out behavior.
--
-- `ALTER TYPE ... ADD VALUE` cannot run inside a transaction that
-- also references the new value, so it's its own statement. `IF NOT
-- EXISTS` makes the migration safe to re-run.

ALTER TYPE "notification_recipient_strategy" ADD VALUE IF NOT EXISTS 'mentioned_in_payload';
