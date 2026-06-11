-- BL-13 Phase E-2b-2b — seed default notification rules per existing
-- tenant.
--
-- Five trigger semantics are currently still served by hardcoded
-- dispatchers (e.g., dispatchReviewCompletedNotification or direct
-- db.insert(notifications) calls). Phase E-2c will retire those
-- hardcoded paths. Before we can, every existing tenant needs default
-- notification_rule rows so the rules engine continues to deliver
-- equivalent notifications.
--
-- Strategy decision (recorded in BACKLOG.md, captured via AskUserQuestion):
--   - Idempotent per (organization_id, trigger_event_kind): if the org
--     already has ANY rule for that kind (custom or earlier seed run),
--     don't insert the default. Lets early adopters keep their
--     configuration.
--
-- Recipient strategy decisions:
--   - review_completed             → two rules per org:
--       (a) formula review_assignee (every reviewer on the closed review)
--       (b) formula proposal_owner   (the proposal manager)
--     Both fire in_app+email immediately.
--   - review_request_pending       → formula review_assignee, in_app+email
--   - comment_mentioned            → mentioned_in_payload, in_app+email
--   - opportunity_reviewed         → formula opportunity_owner, in_app
--   - solicitation_role_assigned   → mentioned_in_payload, in_app
--     (Phase E-2b-1 already populates payload.mentionedUserIds for
--     comment_mentioned; this PR also updates assignSolicitationRoleAction
--     to populate it for solicitation_role_assigned.)
--
-- All rules are created with active=true and frequency=immediate so
-- the post-merge behavior matches the legacy hardcoded paths byte-for-byte
-- on the recipient + channel + cadence axes. created_by_user_id is
-- left NULL since the seed isn't attributable to a specific user.

-- ─────────────────────────────────────────────────────────────────────
-- review_completed (two rules per org: assignees + proposal owner)
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO "notification_rule" (
  "organization_id", "name", "description", "trigger_event_kind",
  "match_filter", "recipient_strategy", "recipient_config", "channels",
  "frequency", "sla_seconds", "escalation_strategy", "active",
  "created_by_user_id"
)
SELECT
  o.id,
  'Default: Color-team review completed (reviewers)',
  'Auto-seeded by migration 0042. Notifies every reviewer assigned to the closed review.',
  'review_completed',
  '{}'::jsonb,
  'formula',
  '{"kind": "review_assignee"}'::jsonb,
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
    AND r.trigger_event_kind = 'review_completed'
);

INSERT INTO "notification_rule" (
  "organization_id", "name", "description", "trigger_event_kind",
  "match_filter", "recipient_strategy", "recipient_config", "channels",
  "frequency", "sla_seconds", "escalation_strategy", "active",
  "created_by_user_id"
)
SELECT
  o.id,
  'Default: Color-team review completed (proposal manager)',
  'Auto-seeded by migration 0042. Notifies the proposal manager when a color-team review closes.',
  'review_completed',
  '{}'::jsonb,
  'formula',
  '{"kind": "proposal_owner"}'::jsonb,
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
    AND r.trigger_event_kind = 'review_completed'
);

-- ─────────────────────────────────────────────────────────────────────
-- review_request_pending
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO "notification_rule" (
  "organization_id", "name", "description", "trigger_event_kind",
  "match_filter", "recipient_strategy", "recipient_config", "channels",
  "frequency", "sla_seconds", "escalation_strategy", "active",
  "created_by_user_id"
)
SELECT
  o.id,
  'Default: Color-team review request pending',
  'Auto-seeded by migration 0042. Notifies the assigned reviewer(s) when a review opens.',
  'review_request_pending',
  '{}'::jsonb,
  'formula',
  '{"kind": "review_assignee"}'::jsonb,
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
    AND r.trigger_event_kind = 'review_request_pending'
);

-- ─────────────────────────────────────────────────────────────────────
-- comment_mentioned
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO "notification_rule" (
  "organization_id", "name", "description", "trigger_event_kind",
  "match_filter", "recipient_strategy", "recipient_config", "channels",
  "frequency", "sla_seconds", "escalation_strategy", "active",
  "created_by_user_id"
)
SELECT
  o.id,
  'Default: Review comment mention',
  'Auto-seeded by migration 0042. Notifies every user @-mentioned in a review comment.',
  'comment_mentioned',
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
    AND r.trigger_event_kind = 'comment_mentioned'
);

-- ─────────────────────────────────────────────────────────────────────
-- opportunity_reviewed
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO "notification_rule" (
  "organization_id", "name", "description", "trigger_event_kind",
  "match_filter", "recipient_strategy", "recipient_config", "channels",
  "frequency", "sla_seconds", "escalation_strategy", "active",
  "created_by_user_id"
)
SELECT
  o.id,
  'Default: Opportunity bid/no-bid review submitted',
  'Auto-seeded by migration 0042. Notifies the opportunity owner when a reviewer submits their bid/no-bid recommendation.',
  'opportunity_reviewed',
  '{}'::jsonb,
  'formula',
  '{"kind": "opportunity_owner"}'::jsonb,
  ARRAY['in_app']::notification_channel[],
  'immediate',
  NULL,
  NULL,
  TRUE,
  NULL
FROM "organization" o
WHERE NOT EXISTS (
  SELECT 1 FROM "notification_rule" r
  WHERE r.organization_id = o.id
    AND r.trigger_event_kind = 'opportunity_reviewed'
);

-- ─────────────────────────────────────────────────────────────────────
-- solicitation_role_assigned
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO "notification_rule" (
  "organization_id", "name", "description", "trigger_event_kind",
  "match_filter", "recipient_strategy", "recipient_config", "channels",
  "frequency", "sla_seconds", "escalation_strategy", "active",
  "created_by_user_id"
)
SELECT
  o.id,
  'Default: Solicitation role assigned',
  'Auto-seeded by migration 0042. Notifies the user newly assigned to a solicitation role.',
  'solicitation_role_assigned',
  '{}'::jsonb,
  'mentioned_in_payload',
  '{}'::jsonb,
  ARRAY['in_app']::notification_channel[],
  'immediate',
  NULL,
  NULL,
  TRUE,
  NULL
FROM "organization" o
WHERE NOT EXISTS (
  SELECT 1 FROM "notification_rule" r
  WHERE r.organization_id = o.id
    AND r.trigger_event_kind = 'solicitation_role_assigned'
);
