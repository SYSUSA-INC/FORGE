-- BL-25 follow-on: platform-wide key/value settings + initial value
-- for cert_retention_months.
--
-- Singleton key-value store for platform-scoped (non-tenant) admin
-- settings. First user: the cert-firm retention threshold (how old a
-- graduated firm has to be before the monthly cron job prunes it).
-- Future settings (e.g. SAM cron toggle, default retention windows
-- per cert type) live here too rather than spinning a fresh table
-- each time.

CREATE TABLE "platform_setting" (
  "key" text PRIMARY KEY,
  "value" text NOT NULL,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "updated_by" text REFERENCES "user"("id") ON DELETE SET NULL
);

-- Seed the cert retention setting. 36 months (3 years) is a reasonable
-- default — covers the period where a recently-graduated 8(a) firm is
-- still a high-value capture target. Operators can shorten or lengthen
-- via /admin/sba-8a.
INSERT INTO "platform_setting" ("key", "value")
VALUES ('cert_retention_months', '36')
ON CONFLICT ("key") DO NOTHING;
