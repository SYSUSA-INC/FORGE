-- Pass 4 audit fixes — missing indexes on hot-path foreign keys.
--
-- Postgres does not auto-index foreign-key columns. Tenant-scoped list
-- pages (e.g. /opportunities, /proposals, /companies, /notifications,
-- compliance matrix) currently do sequential scans on every page load.
-- At 1k+ records per org these queries land in the multi-second range.
--
-- All indexes are non-unique B-tree, IF NOT EXISTS for safe re-runs.
-- These indexes correspond to .index() declarations now added to
-- src/db/schema.ts so future Drizzle migrations don't re-introduce
-- the gap.

-- Hot-path tenant-scoped list pages (P0 — 6 indexes)
CREATE INDEX IF NOT EXISTS notification_recipient_user_id_idx
  ON notification (recipient_user_id);

CREATE INDEX IF NOT EXISTS opportunity_organization_id_idx
  ON opportunity (organization_id);

CREATE INDEX IF NOT EXISTS proposal_organization_id_idx
  ON proposal (organization_id);

CREATE INDEX IF NOT EXISTS proposal_section_proposal_id_idx
  ON proposal_section (proposal_id);

CREATE INDEX IF NOT EXISTS company_organization_id_idx
  ON company (organization_id);

CREATE INDEX IF NOT EXISTS compliance_item_proposal_id_idx
  ON compliance_item (proposal_id);

-- Knowledge fallback queries (P1 — 2 indexes)
CREATE INDEX IF NOT EXISTS knowledge_entry_organization_id_idx
  ON knowledge_entry (organization_id);

CREATE INDEX IF NOT EXISTS knowledge_artifact_organization_id_idx
  ON knowledge_artifact (organization_id);
