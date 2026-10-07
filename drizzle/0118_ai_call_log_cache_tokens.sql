-- BL-AIX Phase 1g — prompt caching telemetry. input_tokens keeps counting
-- every prompt token; these record the part read from, or written to, the
-- provider's prompt cache, so the usage page can show the cached share
-- and price it.
ALTER TABLE "ai_call_log" ADD COLUMN IF NOT EXISTS "cache_read_tokens" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_call_log" ADD COLUMN IF NOT EXISTS "cache_write_tokens" integer DEFAULT 0 NOT NULL;
