-- BL-SCOUT-FIT — each find scored against what the company can do: the closest capability's similarity (0..100), its band (strong, related, weak; null = not scored) and the line that says why; the run counts the weak finds it set aside.
ALTER TABLE "scout_candidate"
  ADD COLUMN IF NOT EXISTS "capability_fit" integer,
  ADD COLUMN IF NOT EXISTS "capability_band" text,
  ADD COLUMN IF NOT EXISTS "capability_basis" text NOT NULL DEFAULT '';
ALTER TABLE "scout_run"
  ADD COLUMN IF NOT EXISTS "weak_hidden" integer NOT NULL DEFAULT 0;
