-- BL-FB-SCAN-CONTRADICTION — cross-volume contradiction detection.
--
-- The AI health scan now also checks whether sections make incompatible
-- claims (e.g., Technical Volume claims 24/7 operations while Management
-- Volume staffs only business hours). Stored alongside sectionIssues so
-- the scan panel can surface specific contradicting pairs with severity.

ALTER TABLE "proposal_scan_result"
  ADD COLUMN "contradictions" jsonb NOT NULL DEFAULT '[]';
