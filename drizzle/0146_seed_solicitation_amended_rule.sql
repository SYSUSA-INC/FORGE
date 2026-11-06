-- BL-SCOUT-AMEND — seed the default `solicitation_amended` rule per
-- existing tenant (on by default, owner 2026-11-03). Separate from 0145
-- because Postgres won't let an INSERT in the same transaction reference
-- an enum value ADDed there. A tenant created later gets the same rule
-- the first time the watch notifies it (src/lib/amendment-watch.ts).
--
-- `mentioned_in_payload`: the watch puts the opportunity's owner and
-- everyone assigned to its proposals and reviews into
-- `payload.mentionedUserIds`.
-- Idempotent: skipped per tenant if any rule of this kind exists.

INSERT INTO "notification_rule" (
  "organization_id", "name", "description", "trigger_event_kind",
  "match_filter", "recipient_strategy", "recipient_config", "channels",
  "frequency", "sla_seconds", "escalation_strategy", "active",
  "created_by_user_id"
)
SELECT
  o.id,
  'Default: Solicitation amended',
  'Auto-seeded by migration 0146. When SAM.gov posts an amendment or a new document for an opportunity you are pursuing, FORGE files it on the opportunity and tells the owner and everyone assigned to its proposals and reviews.',
  'solicitation_amended',
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
    AND r.trigger_event_kind = 'solicitation_amended'
);
