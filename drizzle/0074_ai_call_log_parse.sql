-- BL-AI-TOOLS — structured-output outcome on the AI call ledger.
--
-- With schema validation now happening inside the gateway, each call
-- can record whether the model answered through the forced tool call
-- (via_tool) and whether the payload validated against the caller's
-- schema (parse_ok, NULL for free-text calls and stub responses). This
-- turns "the model returned garbage" from a scattered log line into a
-- per-feature metric on /admin/usage.

ALTER TABLE "ai_call_log"
  ADD COLUMN IF NOT EXISTS "via_tool"    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "parse_ok"    boolean,
  ADD COLUMN IF NOT EXISTS "parse_error" text;
