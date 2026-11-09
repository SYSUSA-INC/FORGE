-- BL-NAV-LIFECYCLE 4b-2 — every tenant gets a default rule for proposal_section_overdue (in-app + email to the section's owner), as proposal_section_assigned (0080) and milestone_due_soon (0162) did. A tenant that already has a rule of this kind keeps its own; the proposal manager is reached by a rule with the "Proposal manager" formula, since the payload carries proposalId.
INSERT INTO "notification_rule" (
  "organization_id", "name", "description", "trigger_event_kind",
  "match_filter", "recipient_strategy", "recipient_config", "channels",
  "frequency", "sla_seconds", "escalation_strategy", "active",
  "created_by_user_id"
)
SELECT
  o.id,
  'Default: Proposal section overdue',
  'Auto-seeded by migration 0164. The day after a proposal section''s due date passes with no draft written, its owner is told once in the inbox and by email.',
  'proposal_section_overdue',
  '{}'::jsonb,
  'mentioned_in_payload',
  '{}'::jsonb,
  ARRAY['in_app', 'email']::notification_channel[],
  'immediate', NULL, NULL, TRUE, NULL
FROM "organization" o
WHERE NOT EXISTS (
  SELECT 1 FROM "notification_rule" r
  WHERE r.organization_id = o.id AND r.trigger_event_kind = 'proposal_section_overdue'
);
