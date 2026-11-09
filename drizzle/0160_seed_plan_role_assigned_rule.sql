-- BL-NAV-LIFECYCLE 4a — every tenant gets a default rule for plan_role_assigned (in-app + email to the person named), as the CRM follow-up (0100) and Solicitation amended (0146) did. A tenant that already has a rule of this kind keeps its own.
INSERT INTO "notification_rule" (
  "organization_id", "name", "description", "trigger_event_kind",
  "match_filter", "recipient_strategy", "recipient_config", "channels",
  "frequency", "sla_seconds", "escalation_strategy", "active",
  "created_by_user_id"
)
SELECT
  o.id,
  'Default: Plan role assigned',
  'Auto-seeded by migration 0160. When someone is named to a role, or a colour team, on an opportunity''s plan, they are told at once, in the inbox and by email.',
  'plan_role_assigned',
  '{}'::jsonb,
  'mentioned_in_payload',
  '{}'::jsonb,
  ARRAY['in_app', 'email']::notification_channel[],
  'immediate', NULL, NULL, TRUE, NULL
FROM "organization" o
WHERE NOT EXISTS (
  SELECT 1 FROM "notification_rule" r
  WHERE r.organization_id = o.id AND r.trigger_event_kind = 'plan_role_assigned'
);
