-- BL-15 Phase B-3c — runtime isolation check results table.
--
-- Each row records the outcome of a superadmin-triggered "is this
-- tenant still isolated from the rest of the DB" probe. The check
-- picks a different tenant as a phantom attacker, scrapes a few row
-- ids from each tenant-scoped table, then runs queries that JOIN
-- those ids against the target tenant's organization_id — those
-- queries MUST return zero rows for an isolated tenant.
--
-- The `details` jsonb stores a per-table result so the operator can
-- see exactly which probe surface (opportunities / proposals /
-- knowledge_artifacts) was tested and what was returned. Failed
-- probes mean a real isolation leak was observed.
--
-- organization_id is the tenant being verified, so the row is
-- tenant-scoped and the static isolation checker auto-registers it.

CREATE TABLE "isolation_check_result" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL
    REFERENCES "organization"("id") ON DELETE CASCADE,
  "triggered_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "triggered_at" timestamp NOT NULL DEFAULT now(),
  "total_checks" integer NOT NULL DEFAULT 0,
  "passed_checks" integer NOT NULL DEFAULT 0,
  "failed_checks" integer NOT NULL DEFAULT 0,
  "skipped_checks" integer NOT NULL DEFAULT 0,
  "details" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "notes" text NOT NULL DEFAULT ''
);

CREATE INDEX "isolation_check_result_org_id_idx"
  ON "isolation_check_result" ("organization_id", "triggered_at" DESC);
