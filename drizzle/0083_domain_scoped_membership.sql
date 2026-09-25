-- BL-AUTH-DOMAIN — domain-scoped tenant membership.
--
-- By default a person may only join the tenant that owns their email
-- domain. Each organization lists the domains it owns and the external
-- domains a platform admin has approved for it. An invite whose address
-- falls outside both lists is "cross-domain": it is created on hold and
-- carries no usable link until a platform superadmin stamps
-- platform_approved_at (a superadmin issuing the invite stamps it at
-- once). Tenant admins alone can never add someone from another domain.
--
-- Backfill: tenants with no domains get the distinct domains of their
-- active admins' emails, excluding public mailbox providers, so the
-- rule takes effect without anyone re-entering data.
--
-- Idempotent and additive.

ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "email_domains" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "approved_external_domains" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_email_domains_gin_idx" ON "organization" USING gin ("email_domains");--> statement-breakpoint
ALTER TABLE "allowlist" ADD COLUMN IF NOT EXISTS "cross_domain" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "allowlist" ADD COLUMN IF NOT EXISTS "home_organization_id" uuid;--> statement-breakpoint
ALTER TABLE "allowlist" ADD COLUMN IF NOT EXISTS "platform_approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "allowlist" ADD COLUMN IF NOT EXISTS "platform_approved_by_user_id" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "allowlist_home_organization_id_idx" ON "allowlist" ("home_organization_id");--> statement-breakpoint
UPDATE "organization" o
SET "email_domains" = sub.domains
FROM (
  SELECT m.organization_id, array_agg(DISTINCT lower(split_part(u.email, '@', 2))) AS domains
  FROM "membership" m
  JOIN "user" u ON u.id = m.user_id
  WHERE m.role = 'admin'
    AND m.status = 'active'
    AND position('@' in u.email) > 0
    AND lower(split_part(u.email, '@', 2)) NOT IN (
      'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
      'yahoo.com', 'ymail.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com',
      'proton.me', 'protonmail.com', 'pm.me', 'zoho.com', 'gmx.com', 'mail.com',
      'fastmail.com', 'hey.com'
    )
  GROUP BY m.organization_id
) sub
WHERE o.id = sub.organization_id
  AND cardinality(o."email_domains") = 0;
