-- BL-FB-X-PWIN-MODEL — PWin estimate snapshots.
--
-- The PWin model is only worth trusting if it is graded. Each snapshot
-- freezes the model's probability for an opportunity at a moment that
-- matters: when a user applies it to the record (trigger='apply') and
-- when a proposal's outcome is decided (trigger='outcome', with the
-- outcome). The 'outcome' rows are the ground truth for the Brier score
-- shown on the opportunity page; the model's own history excludes the
-- opportunity being scored so the grade is not self-fulfilling.

CREATE TABLE IF NOT EXISTS "pwin_snapshot" (
  "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"  uuid        NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "opportunity_id"   uuid        NOT NULL REFERENCES "opportunity"("id") ON DELETE CASCADE,
  "proposal_id"      uuid        REFERENCES "proposal"("id") ON DELETE SET NULL,
  "probability"      real        NOT NULL,
  "pwin"             integer     NOT NULL,
  "manual_pwin"      integer,
  "confidence"       text        NOT NULL DEFAULT 'low',
  "factors"          jsonb       NOT NULL DEFAULT '[]',
  "prior"            jsonb       NOT NULL DEFAULT '{}',
  "calibration"      jsonb       NOT NULL DEFAULT '{}',
  "model_version"    text        NOT NULL,
  "trigger"          text        NOT NULL,
  "outcome"          text,
  "created_at"       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "pwin_snapshot_opp_created_idx"
  ON "pwin_snapshot" ("opportunity_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "pwin_snapshot_org_created_idx"
  ON "pwin_snapshot" ("organization_id", "created_at" DESC);
