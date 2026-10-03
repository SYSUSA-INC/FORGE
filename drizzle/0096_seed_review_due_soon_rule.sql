-- BL-FB-X-COLOR-TEAM Slice 2 — seed the default `review_due_soon` rule
-- per existing tenant. Separate from 0095 because Postgres won't let an
-- INSERT in the same transaction reference an enum value ADDed there.
--
-- `mentioned_in_payload`: the daily cron puts only the reviewers who
-- have not submitted into `payload.mentionedUserIds`.
-- Idempotent: skipped per tenant if any rule of this kind exists.

INSERT INTO "notification_rule" (
  "organization_id", "name", "description", "trigger_event_kind",
  "match_filter", "recipient_strategy", "recipient_config", "channels",
  "frequency", "sla_seconds", "escalation_strategy", "active",
  "created_by_user_id"
)
SELECT
  o.id,
  'Default: Color-team review due soon',
  'Auto-seeded by migration 0096. The day before a colour-team round is due (or once, if it is already overdue), reminds the reviewers who have not submitted their verdict.',
  'review_due_soon',
  '{}'::jsonb,
  'mentioned_in_payload',
  '{}'::jsonb,
  ARRAY['in_app', 'email']::notification_channel[],
  'immediate',
  NULL,
  NULL,
  TRUE,
  NULL
FROM "organization" o
WHERE NOT EXISTS (
  SELECT 1 FROM "notification_rule" r
  WHERE r.organization_id = o.id
    AND r.trigger_event_kind = 'review_due_soon'
);
