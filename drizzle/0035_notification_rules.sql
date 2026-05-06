-- BL-13: Notifications rules engine.
--
-- Tenants define rules that determine WHO gets notified WHEN
-- specific events fire, on WHICH channels, and with what SLA for
-- escalation. The existing `notification` table stays the in-app
-- delivery surface; we add a rules layer on top.
--
-- Two new tables:
--   notification_rule       — the rule definition (org-scoped)
--   notification_delivery   — one row per (rule, recipient) outcome,
--                              for delivery + SLA tracking

CREATE TYPE "notification_rule_event_kind" AS ENUM (
  'opportunity_due_soon',
  'proposal_section_overdue',
  'review_request_pending',
  'audit_anomaly',
  'opportunity_stage_advance',
  'proposal_stage_advance',
  'solicitation_review_complete'
);

CREATE TYPE "notification_recipient_strategy" AS ENUM (
  'specific_users',         -- recipientUserIds[] is authoritative
  'role',                   -- recipientRoles[] = ['admin'|'member'|...]
  'proposal_owner',         -- the owning user of the proposal in payload
  'opportunity_owner',      -- the owning user of the opportunity in payload
  'all_admins'              -- all org admins
);

CREATE TYPE "notification_frequency" AS ENUM (
  'immediate',
  'daily_digest',
  'weekly_digest'
);

CREATE TYPE "notification_delivery_status" AS ENUM (
  'pending',
  'sent',
  'failed',
  'sla_breached',
  'acknowledged'
);

CREATE TABLE "notification_rule" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "name" text NOT NULL DEFAULT '',
  "description" text NOT NULL DEFAULT '',
  "event_kind" "notification_rule_event_kind" NOT NULL,
  -- Match filter: structured json conditions evaluated against the
  -- event payload. Empty = match every event of that kind.
  -- Example: { "stage": "submitted" } only fires for transitions
  -- INTO submitted.
  "match_filter" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "recipient_strategy" "notification_recipient_strategy" NOT NULL,
  "recipient_user_ids" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "recipient_roles" text[] NOT NULL DEFAULT ARRAY[]::text[],
  -- Channels: 'in_app' / 'email' for now; future 'slack' / 'teams'
  -- live behind a config flag.
  "channels" text[] NOT NULL DEFAULT ARRAY['in_app']::text[],
  "frequency" "notification_frequency" NOT NULL DEFAULT 'immediate',
  -- SLA escalation: if not acknowledged in N seconds, notify the
  -- escalation user(s). 0 = no SLA.
  "sla_seconds" integer NOT NULL DEFAULT 0,
  "escalation_user_ids" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "active" boolean NOT NULL DEFAULT true,
  "created_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "notification_rule_org_event_idx"
  ON "notification_rule" ("organization_id", "event_kind", "active");

CREATE TABLE "notification_delivery" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "rule_id" uuid NOT NULL REFERENCES "notification_rule"("id") ON DELETE CASCADE,
  "recipient_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "channel" text NOT NULL,
  "status" "notification_delivery_status" NOT NULL DEFAULT 'pending',
  -- Subject + body snapshot at the time the rule fired.
  "subject" text NOT NULL DEFAULT '',
  "body" text NOT NULL DEFAULT '',
  "link_path" text NOT NULL DEFAULT '',
  -- Reference back to the in-app notification row (when channel='in_app').
  "notification_id" uuid REFERENCES "notification"("id") ON DELETE SET NULL,
  -- For SLA tracking.
  "sla_due_at" timestamp,
  "sent_at" timestamp,
  "acked_at" timestamp,
  "sla_breached_at" timestamp,
  "error" text NOT NULL DEFAULT '',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Pending deliveries to send (immediate frequency).
CREATE INDEX "notification_delivery_pending_idx"
  ON "notification_delivery" ("status", "created_at")
  WHERE status = 'pending';

-- SLA breach detection: deliveries past their due time, not yet acked.
CREATE INDEX "notification_delivery_sla_due_idx"
  ON "notification_delivery" ("sla_due_at")
  WHERE acked_at IS NULL AND sla_breached_at IS NULL AND sla_due_at IS NOT NULL;

-- Per-org listing.
CREATE INDEX "notification_delivery_org_created_idx"
  ON "notification_delivery" ("organization_id", "created_at" DESC);
