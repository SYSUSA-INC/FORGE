-- BL-STAB-10d — the keyword a scout find was kept for.
--
-- A find can match through an earlier notice of its solicitation (the
-- original notice names the keyword; the latest amendment only moves the
-- due date) or through its agency, so its own saved text may not show the
-- keyword. Each run clears waiting finds that no longer fit; with the
-- matched keyword stored, a find whose keyword is still searched for is
-- kept. Empty for finds from before this column and for finds kept with
-- no keywords. Additive, idempotent.

ALTER TABLE "scout_candidate" ADD COLUMN IF NOT EXISTS "matched_keyword" text DEFAULT '' NOT NULL;
