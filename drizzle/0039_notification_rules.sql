-- BL-13 Phase A — notification rules engine schema.
--
-- Two tables:
--   - notification_rule: the configurable rule itself. Who is notified,
--     about what trigger, on which channels, at what frequency, with
--     what SLA + escalation.
--   - notification_delivery: per-rule, per-recipient delivery tracking
--     for SLA + retry + acked state. Separate from the existing
--     `notification` table (which is the in-app inbox); a single
--     delivery row may correspond to zero or one rows in `notification`
--     depending on the channel.
--
-- Phase B will add the rule-CRUD server actions + editor UI.
-- Phase C will add the trigger dispatcher that creates delivery rows.
-- Phase D will add the cron-based SLA breach + escalation.

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------

CREATE TYPE "notification_trigger_event_kind" AS ENUM (
  'opportunity_due_soon',
  'opportunity_advanced',
  'opportunity_no_bid',
  'opportunity_won',
  'opportunity_lost',
  'proposal_created',
  'proposal_advanced',
  'proposal_section_overdue',
  'review_request_pending',
  'review_completed',
  'compliance_overdue',
  'audit_anomaly',
  'membership_invited',
  'membership_disabled'
);

CREATE TYPE "notification_recipient_strategy" AS ENUM (
  'specific_users',
  'role_based',
  'formula'
);

CREATE TYPE "notification_channel" AS ENUM (
  'in_app',
  'email',
  'slack',
  'teams'
);

CREATE TYPE "notification_frequency" AS ENUM (
  'immediate',
  'batched_daily',
  'batched_weekly'
);

-- ---------------------------------------------------------------------
-- notification_rule — the configurable rule.
-- ---------------------------------------------------------------------

CREATE TABLE "notification_rule" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "trigger_event_kind" notification_trigger_event_kind NOT NULL,
  -- Additional filtering on the trigger payload, e.g.
  --   { "stage": "submitted" } to fire only for proposals in submitted stage.
  -- Empty object = match everything for that event kind.
  "match_filter" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "recipient_strategy" notification_recipient_strategy NOT NULL,
  -- Shape depends on recipient_strategy:
  --   specific_users: { userIds: [<uuid>] }
  --   role_based:     { roles: ["admin" | "capture" | ...] }
  --   formula:        { kind: "proposal_owner" | "opportunity_owner" | "capture_mgr" | "pricing_lead" | "section_author" }
  "recipient_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Array because a rule may fan out to multiple channels (e.g. in-app + email).
  "channels" notification_channel[] NOT NULL DEFAULT ARRAY['in_app']::notification_channel[],
  "frequency" notification_frequency NOT NULL DEFAULT 'immediate',
  -- Seconds to wait for acknowledgement before flagging as breached.
  -- NULL = no SLA (informational only).
  "sla_seconds" integer,
  -- When SLA breaches, who gets escalated to. Same shape as
  -- recipient_strategy + recipient_config but stored as one jsonb blob
  -- for simplicity: { strategy, config }. NULL = no escalation.
  "escalation_strategy" jsonb,
  "active" boolean NOT NULL DEFAULT true,
  "created_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "notification_rule_org_active_idx"
  ON "notification_rule" ("organization_id", "active");
CREATE INDEX "notification_rule_org_event_idx"
  ON "notification_rule" ("organization_id", "trigger_event_kind");

-- ---------------------------------------------------------------------
-- notification_delivery — per-recipient delivery + SLA tracking.
-- ---------------------------------------------------------------------

CREATE TABLE "notification_delivery" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Denormalized for tenant isolation enforcement at the query layer
  -- (every SELECT/UPDATE goes through `organization_id` even though
  -- it could be joined via rule_id).
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "rule_id" uuid NOT NULL REFERENCES "notification_rule"("id") ON DELETE CASCADE,
  -- Denormalized so we can filter on event kind without joining the rule.
  "trigger_event_kind" notification_trigger_event_kind NOT NULL,
  -- The payload that fired the rule, e.g.
  --   { "opportunityId": "...", "stage": "submitted" }
  "trigger_payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Resolved at dispatch time from the rule's recipient_strategy.
  -- May be NULL for batched-pending rows (will be set when the batch
  -- is materialized).
  "recipient_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "channel" notification_channel NOT NULL,
  "sent_at" timestamp,
  "acked_at" timestamp,
  "sla_breached_at" timestamp,
  "escalated_at" timestamp,
  "error" text NOT NULL DEFAULT '',
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "notification_delivery_org_rule_idx"
  ON "notification_delivery" ("organization_id", "rule_id", "created_at");
CREATE INDEX "notification_delivery_recipient_idx"
  ON "notification_delivery" ("recipient_user_id", "created_at");
-- Cron query: scan for unacked deliveries past SLA.
CREATE INDEX "notification_delivery_sla_pending_idx"
  ON "notification_delivery" ("organization_id", "sent_at")
  WHERE "acked_at" IS NULL AND "sla_breached_at" IS NULL;
