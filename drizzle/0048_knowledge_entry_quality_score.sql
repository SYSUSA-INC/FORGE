-- BL-10 Phase D-1 — knowledge entry quality scoring.
--
-- Adds three columns to capture the Brain's confidence in each
-- knowledge entry. Scoring runs lazily (no automatic backfill in
-- Phase D-1); Phase D-2 wires the scorer into the entry-create /
-- entry-update paths so new + edited entries get scored
-- automatically.
--
-- Column semantics:
--   quality_score          0..1 real, or NULL if never scored.
--                          The scorer computes this from text-shape
--                          heuristics + kind-specific signals
--                          (dates for past_performance, structure
--                          for capability, etc.). 0 = bare-minimum
--                          row, 1 = strong asset the Brain can
--                          confidently surface.
--   quality_score_factors  jsonb breakdown of the individual signal
--                          contributions — surface in the editor UI
--                          so authors see WHY their entry scored
--                          what it scored. Shape matches
--                          QualityFactors in src/lib/knowledge-quality.ts.
--   quality_scored_at      timestamp of the last score; lets us
--                          re-score stale entries after the scorer
--                          itself changes.

ALTER TABLE "knowledge_entry"
  ADD COLUMN "quality_score"         real,
  ADD COLUMN "quality_score_factors" jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "quality_scored_at"     timestamp;
