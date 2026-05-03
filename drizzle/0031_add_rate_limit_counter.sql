-- Phase audit fixes — rate limiting infrastructure.
--
-- DB-backed token-bucket-ish counter. For each (key, window_start)
-- pair we increment a count. The application enforces the limit by
-- comparing the resulting count to a per-key limit at write time.
--
-- Why DB-backed:
--   - We want rate limiting NOW (security risk is real and immediate).
--   - We don't currently provision Upstash/Redis or Vercel KV.
--   - Sub-millisecond latency isn't required for our endpoints (the
--     gated actions take 100ms+ anyway).
--   - Postgres handles single-row UPSERT at thousands of qps; our
--     traffic is far below that.
--
-- We can swap to Upstash later by changing the implementation in
-- src/lib/rate-limit.ts; the call sites stay the same.
--
-- A sweeper job (or a periodic DELETE) cleans rows older than 24h to
-- keep the table small. Not required for correctness; just hygiene.

CREATE TABLE IF NOT EXISTS "rate_limit_counter" (
  "key" text NOT NULL,
  "window_start" timestamp NOT NULL,
  "count" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "rate_limit_counter_pk" PRIMARY KEY ("key", "window_start")
);

CREATE INDEX IF NOT EXISTS "rate_limit_counter_updated_at_idx"
  ON "rate_limit_counter" ("updated_at");
