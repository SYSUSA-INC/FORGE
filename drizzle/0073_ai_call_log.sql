-- BL-AI-TELEMETRY — per-call AI telemetry ledger.
--
-- One row per tenant AI call made through completeForTenant, whether it
-- succeeded, failed at the provider, or was refused at the token-cap
-- pre-check. Until now the only AI visibility was the aggregate
-- tenant_usage_counter (tokens + requests per month per tenant). This
-- table adds the per-feature dimension: which product surface made the
-- call, which model answered, how long it took, how many tokens it
-- consumed, and whether it errored. That is the substrate for model
-- routing, prompt regression checks, and per-feature cost accounting.
--
-- Pruned by /api/cron/prune-audit-logs (AI_CALL_LOG_RETENTION_DAYS,
-- default 90). Rows cascade on organization delete.

CREATE TABLE IF NOT EXISTS "ai_call_log" (
  "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"  uuid        NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "feature"          text        NOT NULL DEFAULT 'unknown',
  "variant"          text        NOT NULL DEFAULT '',
  "prompt_version"   text        NOT NULL DEFAULT '',
  "provider"         text        NOT NULL DEFAULT '',
  "model"            text        NOT NULL DEFAULT '',
  "requested_model"  text        NOT NULL DEFAULT '',
  "status"           text        NOT NULL,
  "error"            text,
  "input_tokens"     integer     NOT NULL DEFAULT 0,
  "output_tokens"    integer     NOT NULL DEFAULT 0,
  "output_chars"     integer     NOT NULL DEFAULT 0,
  "max_tokens"       integer,
  "latency_ms"       integer     NOT NULL DEFAULT 0,
  "stubbed"          boolean     NOT NULL DEFAULT false,
  "cache_system"     boolean     NOT NULL DEFAULT false,
  "has_documents"    boolean     NOT NULL DEFAULT false,
  "created_at"       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "acl_org_created_idx"
  ON "ai_call_log" ("organization_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "acl_feature_created_idx"
  ON "ai_call_log" ("feature", "created_at" DESC);
