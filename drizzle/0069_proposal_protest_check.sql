-- BL-FB-WIN-PROTEST — protest viability check.
--
-- Per-proposal AI analysis that examines debrief weaknesses +
-- evaluation criteria + solicitation context and returns a risk-tier
-- summary (none / weak / colorable / strong) with the specific GAO
-- grounds and controlling cases that support any viable challenge.
-- Only surfaces grounds when specific debrief evidence supports them.

CREATE TYPE "protest_risk_tier" AS ENUM ('none', 'weak', 'colorable', 'strong');

CREATE TABLE "proposal_protest_check" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"     uuid        NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "proposal_id"         uuid        UNIQUE NOT NULL REFERENCES "proposal"("id") ON DELETE CASCADE,
  "risk_tier"           "protest_risk_tier" NOT NULL DEFAULT 'none',
  "summary"             text        NOT NULL DEFAULT '',
  "grounds"             jsonb       NOT NULL DEFAULT '[]',
  "model"               text        NOT NULL DEFAULT '',
  "stubbed"             boolean     NOT NULL DEFAULT false,
  "created_by_user_id"  text        REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "protest_check_org_idx" ON "proposal_protest_check" ("organization_id", "created_at" DESC);
