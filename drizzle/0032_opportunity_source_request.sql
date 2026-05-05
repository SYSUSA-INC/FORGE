-- BL-6: customer-suggested opportunity sources.
--
-- Tenants submit a source they'd like FORGE to support (e.g. a
-- specific GovWin feed, a state procurement portal). Super-admin
-- triages, marks status, leaves platform notes. Suggestions are
-- inputs to the platform roadmap — see backlog item BL-6.

CREATE TYPE "opportunity_source_request_status" AS ENUM (
  'pending',
  'under_review',
  'shipped',
  'rejected'
);

CREATE TABLE "opportunity_source_request" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "requester_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "source_name" text NOT NULL DEFAULT '',
  "description" text NOT NULL DEFAULT '',
  -- Optional sample text the customer pasted so we can prototype
  -- against a real example. May be empty.
  "sample_text" text NOT NULL DEFAULT '',
  "status" "opportunity_source_request_status" NOT NULL DEFAULT 'pending',
  -- Platform-side triage notes; super-admin only writes to this.
  "platform_notes" text NOT NULL DEFAULT '',
  -- When status was last changed; lets us show "moved to under
  -- review 3 days ago" on the tenant view.
  "status_changed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- Tenant view: list own requests sorted by recency.
CREATE INDEX "opportunity_source_request_org_created_idx"
  ON "opportunity_source_request" ("organization_id", "created_at" DESC);

-- Super-admin triage: filter by status, sorted by recency.
CREATE INDEX "opportunity_source_request_status_created_idx"
  ON "opportunity_source_request" ("status", "created_at" DESC);
