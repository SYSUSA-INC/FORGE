-- BL-NAV-LIFECYCLE 4b-1 — every tenant gets a default rule for milestone_due_soon (in-app + email to the milestone's owner), as plan_role_assigned (0160) did. A tenant that already has a rule of this kind keeps its own.
INSERT INTO "notification_rule" (
  "organization_id", "name", "description", "trigger_event_kind",
  "match_filter", "recipient_strategy", "recipient_config", "channels",
  "frequency", "sla_seconds", "escalation_strategy", "active",
  "created_by_user_id"
)
SELECT
  o.id,
  'Default: Milestone due soon',
  'Auto-seeded by migration 0162. Seven, three and one days before a planned milestone on an opportunity''s plan, its owner is reminded in the inbox and by email.',
  'milestone_due_soon',
  '{}'::jsonb,
  'mentioned_in_payload',
  '{}'::jsonb,
  ARRAY['in_app', 'email']::notification_channel[],
  'immediate', NULL, NULL, TRUE, NULL
FROM "organization" o
WHERE NOT EXISTS (
  SELECT 1 FROM "notification_rule" r
  WHERE r.organization_id = o.id AND r.trigger_event_kind = 'milestone_due_soon'
);
