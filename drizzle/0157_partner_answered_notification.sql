-- BL-NAV-LIFECYCLE 3c-2 — the inviter is told in the inbox when a partner submits its answers.
ALTER TYPE "notification_kind" ADD VALUE IF NOT EXISTS 'partner_answered';
