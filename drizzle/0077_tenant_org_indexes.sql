-- 0077_tenant_org_indexes.sql
--
-- BL-TENANT-AUDIT (2026-09 re-run) — leading organization_id indexes.
--
-- scripts/check-tenant-firewall.mjs asserts that every tenant-scoped
-- table has an index that leads with organization_id, so tenant-scoped
-- reads never fall back to a sequential scan across every tenant. The
-- re-run found thirteen tables without one. Several are now read
-- directly by organization on hot paths (Phase C outcome intelligence
-- loads proposal_outcome, proposal_debrief, proposal_winner_analysis and
-- solicitation by org), so these are performance fixes as well as the
-- firewall invariant.
--
-- Where the audited read pattern filters or orders on a second column
-- the index is a composite led by organization_id (org + status,
-- org + artifact_id, org + proposal_id, org + timestamp DESC) so the
-- whole predicate is served by the index. Every statement is idempotent; safe to
-- re-run; forward-only; additive.

CREATE INDEX IF NOT EXISTS "allowlist_organization_id_idx"
  ON "allowlist" ("organization_id");

CREATE INDEX IF NOT EXISTS "membership_organization_id_idx"
  ON "membership" ("organization_id", "status");

CREATE INDEX IF NOT EXISTS "notification_org_created_idx"
  ON "notification" ("organization_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "solicitation_org_created_idx"
  ON "solicitation" ("organization_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "proposal_outcome_org_updated_idx"
  ON "proposal_outcome" ("organization_id", "updated_at" DESC);

CREATE INDEX IF NOT EXISTS "proposal_debrief_organization_id_idx"
  ON "proposal_debrief" ("organization_id", "updated_at" DESC);

CREATE INDEX IF NOT EXISTS "proposal_template_organization_id_idx"
  ON "proposal_template" ("organization_id", "is_default");

CREATE INDEX IF NOT EXISTS "proposal_pdf_render_organization_id_idx"
  ON "proposal_pdf_render" ("organization_id", "proposal_id");

CREATE INDEX IF NOT EXISTS "proposal_winner_analysis_organization_id_idx"
  ON "proposal_winner_analysis" ("organization_id");

CREATE INDEX IF NOT EXISTS "opportunity_review_request_organization_id_idx"
  ON "opportunity_review_request" ("organization_id", "opportunity_id");

CREATE INDEX IF NOT EXISTS "solicitation_assignment_organization_id_idx"
  ON "solicitation_assignment" ("organization_id");

CREATE INDEX IF NOT EXISTS "knowledge_extraction_run_organization_id_idx"
  ON "knowledge_extraction_run" ("organization_id", "artifact_id");

CREATE INDEX IF NOT EXISTS "knowledge_extraction_candidate_organization_id_idx"
  ON "knowledge_extraction_candidate" ("organization_id", "artifact_id");
