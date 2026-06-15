-- BL-QC-errors — in-app production error log table.
--
-- Replaces what an external observability backend (e.g., Sentry) would
-- give us. Same idea — uncaught exceptions land here, deduped by a
-- fingerprint hashed from the stack trace's top frames, so 1000
-- firings of the same bug become 1 row with occurrence_count = 1000.
--
-- Tenant column is nullable so pre-auth errors still get logged. The
-- admin viewer at /admin/errors is superadmin-scoped and queries
-- across the whole table — no tenant scoping enforced here because
-- the table is platform-wide ops data, not tenant-owned data.

CREATE TABLE IF NOT EXISTS "production_error" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "organization_id" uuid
        REFERENCES "organization"("id") ON DELETE SET NULL,
    "user_id" text
        REFERENCES "user"("id") ON DELETE SET NULL,
    "fingerprint" text NOT NULL,
    "message" text NOT NULL,
    "stack" text NOT NULL DEFAULT '',
    "runtime" text NOT NULL DEFAULT 'server',
    "environment" text NOT NULL DEFAULT '',
    "request_path" text NOT NULL DEFAULT '',
    "request_method" text NOT NULL DEFAULT '',
    "http_status" integer,
    "user_agent" text NOT NULL DEFAULT '',
    "release_sha" text NOT NULL DEFAULT '',
    "first_seen_at" timestamp NOT NULL DEFAULT now(),
    "last_seen_at" timestamp NOT NULL DEFAULT now(),
    "occurrence_count" integer NOT NULL DEFAULT 1,
    "acknowledged_at" timestamp,
    "acknowledged_by_user_id" text
        REFERENCES "user"("id") ON DELETE SET NULL,
    "resolved_at" timestamp,
    "resolved_by_user_id" text
        REFERENCES "user"("id") ON DELETE SET NULL,
    "notes" text NOT NULL DEFAULT '',
    "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "production_error_fingerprint_idx"
    ON "production_error" ("fingerprint");

CREATE INDEX IF NOT EXISTS "production_error_last_seen_idx"
    ON "production_error" ("last_seen_at");

CREATE INDEX IF NOT EXISTS "production_error_org_last_seen_idx"
    ON "production_error" ("organization_id", "last_seen_at");

-- Partial index: unresolved errors only. Lets the default
-- "show me what needs attention" admin query stay fast even after
-- the resolved-history grows.
CREATE INDEX IF NOT EXISTS "production_error_unresolved_idx"
    ON "production_error" ("last_seen_at")
    WHERE "resolved_at" IS NULL;
