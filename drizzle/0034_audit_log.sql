-- BL-12: Tenant-scoped audit log.
--
-- Captures every mutating server action (and sensitive reads) across
-- the system. Indexed for two query patterns:
--   1. "Show me everything that happened in this org, newest first"
--   2. "What was done to this specific resource?"

CREATE TABLE "audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  -- Actor — null only for system / cron jobs (none today, but reserve).
  "actor_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  -- Snapshot of the actor's email at the time. Survives the actor
  -- being later deleted/disabled so the log stays readable.
  "actor_email_snapshot" text NOT NULL DEFAULT '',
  -- Free-form action verb, e.g. "opportunity.create",
  -- "proposal.advance_stage", "user.invite", "settings.update".
  "action" text NOT NULL,
  -- Resource the action targeted. resource_id may be null for
  -- collection-scoped actions like "settings.update".
  "resource_type" text NOT NULL DEFAULT '',
  "resource_id" text NOT NULL DEFAULT '',
  -- Action-specific structured detail (before/after diffs, ids of
  -- secondary objects, etc.). Always jsonb, never null.
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Best-effort request context for forensics. May be empty when the
  -- action runs outside an HTTP context (server tasks).
  "ip" text NOT NULL DEFAULT '',
  "user_agent" text NOT NULL DEFAULT '',
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- 1. Tenant-scoped feed, newest first.
CREATE INDEX "audit_log_org_created_idx"
  ON "audit_log" ("organization_id", "created_at" DESC);

-- 2. Resource-scoped lookup ("history of opportunity X").
CREATE INDEX "audit_log_org_resource_idx"
  ON "audit_log" ("organization_id", "resource_type", "resource_id");

-- 3. Actor-scoped lookup ("everything user X did").
CREATE INDEX "audit_log_org_actor_idx"
  ON "audit_log" ("organization_id", "actor_user_id", "created_at" DESC);
