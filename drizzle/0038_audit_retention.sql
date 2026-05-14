-- BL-12c — per-tenant audit-log retention window.
--
-- Daily cron at /api/cron/prune-audit-logs deletes rows older than
-- this window per tenant. Default 365 days is a reasonable starting
-- point for fed-contractor compliance use cases while keeping the
-- audit_log table from growing unbounded. The action layer bounds
-- this 90–3650 days; the column is wider in case ops needs to drop
-- the floor without a migration.

ALTER TABLE "organization"
  ADD COLUMN IF NOT EXISTS "audit_retention_days" integer NOT NULL DEFAULT 365;
