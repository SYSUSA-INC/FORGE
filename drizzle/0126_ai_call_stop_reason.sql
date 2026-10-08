-- BL-STAB-9 — record why the AI provider stopped.
--
-- A structured answer cut off at the output ceiling used to look like a
-- finished answer with the wrong shape ("requirements: expected array,
-- received undefined"), and nothing recorded that it had been cut off.
-- The gateway now fails such an answer with a message that says so, and
-- every call logs the provider's stop reason ("end_turn", "tool_use",
-- "max_tokens", "length", …) so a cut-off answer can be found later.
-- Nullable: rows written before this migration have none. Additive,
-- idempotent.

ALTER TABLE "ai_call_log" ADD COLUMN IF NOT EXISTS "stop_reason" text;
