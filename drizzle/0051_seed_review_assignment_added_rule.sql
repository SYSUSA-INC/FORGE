-- BL-13 Phase E-2d — seed default `review_assignment_added` rule
-- per existing tenant.
--
-- Created in a separate migration from 0050 because Postgres won't
-- let an INSERT in the same transaction reference an enum value
-- ADDed in that same transaction.
--
-- The seeded rule uses the `mentioned_in_payload` recipient strategy
-- so only the newly-assigned reviewer is notified (NOT every
-- existing reviewer on the review). assignReviewerAction populates
-- `payload.mentionedUserIds = [input.userId]` to make this work.
--
-- Idempotent: skipped per tenant if any rule for
-- `review_assignment_added` already exists for that tenant.

INSERT INTO "notification_rule" (
  "organization_id", "name", "description", "trigger_event_kind",
  "match_filter", "recipient_strategy", "recipient_config", "channels",
  "frequency", "sla_seconds", "escalation_strategy", "active",
  "created_by_user_id"
)
SELECT
  o.id,
  'Default: Color-team reviewer added late',
  'Auto-seeded by migration 0051. Notifies only the newly-assigned reviewer when assignReviewerAction adds a reviewer to an in-progress review — distinct from the initial review-start fan-out which uses review_request_pending.',
  'review_assignment_added',
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
    AND r.trigger_event_kind = 'review_assignment_added'
);
