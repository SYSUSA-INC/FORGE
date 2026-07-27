-- BL-FB-SCAN-THEMES — per-section win-theme coverage in the health scan.
--
-- The AI scan now returns a structured breakdown of which win themes each
-- section reinforces vs. misses. Stored as JSONB alongside the existing
-- section_issues array so both the sections accordion and the scan panel
-- can surface per-section coverage badges.

ALTER TABLE "proposal_scan_result"
  ADD COLUMN "section_theme_coverage" jsonb NOT NULL DEFAULT '[]';
