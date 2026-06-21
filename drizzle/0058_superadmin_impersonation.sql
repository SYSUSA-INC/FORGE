-- BL-15 Phase B-3b — super-admin assume-identity sessions.
--
-- When a super-admin needs to "assume" a tenant's identity for
-- investigation, support, or debugging, we create a row here. The row
-- is the source of truth for the impersonation; the cookie is just an
-- opaque pointer to it. This lets the super-admin revoke from anywhere,
-- gives us a permanent audit trail, and survives JWT refresh.
--
-- Columns:
--   - id                       — UUID, surfaced in the session cookie.
--   - superadmin_user_id       — who started the session (FK user.id).
--   - target_organization_id   — which tenant is being viewed (FK).
--   - reason                   — required free-text justification.
--   - started_at / expires_at  — 1-hour TTL by default. Expired sessions
--                                are rejected by `requireCurrentOrg`
--                                without ever activating.
--   - ended_at                 — set when the super-admin ends the session
--                                or the cleanup cron sweeps an expired one.
--                                Indexed via partial index for fast
--                                "is there an active session?" lookup.
--
-- Index: partial on superadmin_user_id WHERE ended_at IS NULL — every
-- request from a super-admin checks "do I have an active session?"; this
-- keeps that lookup O(1) for normal browsing.

CREATE TABLE IF NOT EXISTS "superadmin_impersonation_session" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "superadmin_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "target_organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "reason" text NOT NULL,
  "started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone NOT NULL,
  "ended_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_superadmin_imp_active_by_user"
  ON "superadmin_impersonation_session" ("superadmin_user_id")
  WHERE "ended_at" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_superadmin_imp_target"
  ON "superadmin_impersonation_session" ("target_organization_id");
