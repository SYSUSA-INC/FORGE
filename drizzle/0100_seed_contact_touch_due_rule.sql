-- BL-FB-X-CRM Slice 2 — seed the default `contact_touch_due` rule per
-- existing tenant. Separate from 0099 because Postgres won't let an
-- INSERT in the same transaction reference an enum value ADDed there.
--
-- `mentioned_in_payload`: the daily cron puts the contact's relationship
-- owner into `payload.mentionedUserIds`.
-- Idempotent: skipped per tenant if any rule of this kind exists.

INSERT INTO "notification_rule" (
  "organization_id", "name", "description", "trigger_event_kind",
  "match_filter", "recipient_strategy", "recipient_config", "channels",
  "frequency", "sla_seconds", "escalation_strategy", "active",
  "created_by_user_id"
)
SELECT
  o.id,
  'Default: Customer contact follow-up due',
  'Auto-seeded by migration 0100. The day before a customer contact''s agreed next touch (or once, if it is already overdue), reminds the relationship owner.',
  'contact_touch_due',
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
    AND r.trigger_event_kind = 'contact_touch_due'
);
