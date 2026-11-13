-- BL-SCOUT-LEARN — Scout learns from the tenant's own outcomes: each find's learned adjustment to its score (null = learning was not acting), an org admin's switch and reset (a reset only stops reading older outcomes; nothing is deleted), and how many outcomes a run learned from.
ALTER TABLE "scout_candidate"
  ADD COLUMN IF NOT EXISTS "affinity" integer;
ALTER TABLE "scout_profile"
  ADD COLUMN IF NOT EXISTS "learning_enabled" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "learning_reset_at" timestamp with time zone;
ALTER TABLE "scout_run"
  ADD COLUMN IF NOT EXISTS "learned_from" integer NOT NULL DEFAULT 0;
