-- BL-FB-GEN-THEMES — per-proposal win themes.
--
-- 1-3 short structured themes the AI weaves into every section
-- draft. Stored as jsonb on the proposal row (no separate table —
-- always loaded with the proposal, and capped at 3 entries by app
-- code).
--
-- Each entry: { title: string, statement: string }

ALTER TABLE "proposal"
  ADD COLUMN "win_themes" jsonb NOT NULL DEFAULT '[]'::jsonb;
