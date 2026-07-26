-- BL-FB-SCAN-CONTINUOUS — persist proposal health scans + dirty flag
--
-- The on-demand scan from PR #243 returned its result inline but never
-- persisted it. To drive section-level health dots and continuous
-- updates, the scan result now lives in a dedicated table (one row
-- per proposal, UPSERT), and `proposal.scan_dirty_since` flags when
-- content changed since the last scan so subsequent page loads can
-- trigger a fresh scan if the existing result is stale.

CREATE TABLE "proposal_scan_result" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "proposal_id" uuid NOT NULL UNIQUE REFERENCES "proposal"("id") ON DELETE CASCADE,
  "overall_score" text NOT NULL DEFAULT 'needs_work',
  "summary" text NOT NULL DEFAULT '',
  "section_issues" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "top_recommendations" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "stubbed" boolean NOT NULL DEFAULT false,
  "generated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "proposal_scan_result_org_idx"
  ON "proposal_scan_result" ("organization_id");

-- Marker column. NULL = scan is fresh. Non-NULL = there's been a
-- content change since the last scan; subsequent page loads can use
-- this + a debounce window to decide whether to fire a refresh.
ALTER TABLE "proposal"
  ADD COLUMN "scan_dirty_since" timestamp;
