-- BL-FB-GEN-VOICE Slice 3 — house style per proposal volume.
--
-- The team's house style (house_style, 0101) applies to every section;
-- these extra rules apply only to sections of one volume (a section
-- kind: technical, management, past_performance, pricing, …), given to
-- the drafter and chat after the team rules and before the author's own
-- voice. { "<kind>": "<rules, one per line>" }. Idempotent, additive.

ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "house_style_by_volume" jsonb NOT NULL DEFAULT '{}'::jsonb;
