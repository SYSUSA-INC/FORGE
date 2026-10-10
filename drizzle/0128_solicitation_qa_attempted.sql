-- BL-STAB-7d — when the daily Q&A check last tried a solicitation.
--
-- qa_checked_at records only checks SAM.gov answered (so "SAM.gov checked
-- <date>" stays true). A notice that keeps failing (a mistyped notice ID,
-- a company key SAM.gov rejects) used to stay at the head of the queue,
-- ahead of every other company's notices; the queue now orders by the
-- last attempt, so failing rows rotate to the back. Additive, idempotent.

ALTER TABLE "solicitation" ADD COLUMN IF NOT EXISTS "qa_attempted_at" timestamptz;
