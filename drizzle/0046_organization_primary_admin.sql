-- BL-15 Phase B-2 — primary admin pointer on `organization`.
--
-- Adds a nullable FK to `user` for "who is the primary admin of this
-- tenant?". Used by:
--   - The SuperAdmin UI's "Transfer ownership" dropdown
--   - The (future) "cannot demote primary admin" guards on the org's
--     /users page
--   - Billing / contract correspondence (the primary admin is the
--     person we email about subscription changes)
--
-- Backfill: every existing org gets its OLDEST active admin
-- membership as primary. Orgs with no active admin stay NULL until
-- a superadmin assigns one via the UI.
--
-- ON DELETE SET NULL — if the user is hard-deleted, the org keeps
-- existing but the pointer clears; the next superadmin / inviter
-- becomes responsible for picking a replacement.

ALTER TABLE "organization"
  ADD COLUMN "primary_admin_user_id" text
  REFERENCES "user"("id") ON DELETE SET NULL;

-- Backfill: oldest active admin membership wins. The subquery picks
-- one user_id per org based on the earliest created_at on a row with
-- role='admin' and status='active'. Orgs with no admins stay NULL.
UPDATE "organization" o
SET "primary_admin_user_id" = (
  SELECT m.user_id
  FROM "membership" m
  WHERE m.organization_id = o.id
    AND m.role = 'admin'
    AND m.status = 'active'
  ORDER BY m.created_at ASC
  LIMIT 1
);
