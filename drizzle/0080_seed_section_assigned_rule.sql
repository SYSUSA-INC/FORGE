-- BL-AIP-3 — seed default `proposal_section_assigned` rule per
-- existing tenant.
--
-- Separate from 0079 because Postgres won't let an INSERT in the same
-- transaction reference an enum value ADDed in that same transaction.
--
-- The seeded rule uses the `mentioned_in_payload` recipient strategy
-- so only the newly-assigned section author is notified.
-- saveSectionAction populates `payload.mentionedUserIds = [newAuthor]`
-- to make this work.
--
-- Idempotent: skipped per tenant if any rule for
-- `proposal_section_assigned` already exists for that tenant.

INSERT INTO "notification_rule" (
  "organization_id", "name", "description", "trigger_event_kind",
  "match_filter", "recipient_strategy", "recipient_config", "channels",
  "frequency", "sla_seconds", "escalation_strategy", "active",
  "created_by_user_id"
)
SELECT
  o.id,
  'Default: Proposal section assigned',
  'Auto-seeded by migration 0080. Notifies only the newly-assigned author when a proposal section is assigned to them in the section editor. Assigning a section to yourself does not fire.',
  'proposal_section_assigned',
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
    AND r.trigger_event_kind = 'proposal_section_assigned'
);
