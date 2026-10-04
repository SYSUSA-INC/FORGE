-- BL-16 apiAccess — tenant API tokens for the read-only /api/v1 API.
--
-- An org admin creates a token under Settings → API access; the plain
-- token is shown once and only its SHA-256 hash is stored. A request
-- presents it as `Authorization: Bearer forge_…`; the hash resolves the
-- tenant. Tokens belong to the workspace (not to the person who made
-- them), can expire, and are revoked rather than deleted so the audit
-- trail keeps its prefix. Idempotent and additive.

CREATE TABLE IF NOT EXISTS "api_token" (
  "id"                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"     uuid         NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "name"                text         NOT NULL,
  "token_prefix"        varchar(16)  NOT NULL,
  "token_hash"          varchar(64)  NOT NULL UNIQUE,
  "created_by_user_id"  text         REFERENCES "user"("id") ON DELETE SET NULL,
  "expires_at"          timestamp,
  "last_used_at"        timestamp,
  "revoked_at"          timestamp,
  "revoked_by_user_id"  text         REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at"          timestamp    NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_token_org_created_idx" ON "api_token" ("organization_id", "created_at");
