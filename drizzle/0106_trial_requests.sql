-- BL-AUTH-ABUSE Slice 2b — the Request-a-trial queue. Platform-level
-- (no tenant yet: a request becomes a tenant only when a platform admin
-- approves it, and `created_organization_id` then points at it). One
-- pending request per email address. Idempotent and additive.

CREATE TABLE IF NOT EXISTS "trial_request" (
  "id"                       uuid       PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"                     text       NOT NULL,
  "email"                    text       NOT NULL,
  "email_domain"             text       NOT NULL,
  "company"                  text       NOT NULL,
  "job_title"                text       NOT NULL DEFAULT '',
  "message"                  text       NOT NULL DEFAULT '',
  "status"                   text       NOT NULL DEFAULT 'pending',
  "source_ip"                text       NOT NULL DEFAULT '',
  "decided_at"               timestamp,
  "decided_by_user_id"       text       REFERENCES "user"("id") ON DELETE SET NULL,
  "decline_reason"           text       NOT NULL DEFAULT '',
  "created_organization_id"  uuid       REFERENCES "organization"("id") ON DELETE SET NULL,
  "created_at"               timestamp  NOT NULL DEFAULT now(),
  "updated_at"               timestamp  NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trial_request_status_created_idx" ON "trial_request" ("status", "created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trial_request_pending_email_uq" ON "trial_request" ("email") WHERE "status" = 'pending';
