-- BL-FB-X-CRM Slice 1 — customer contacts: who we know at each agency,
-- the role they hold, when we last spoke and when we should next, with
-- the touch log behind those dates. Both tables carry organization_id;
-- agency_key is the normalised agency name used to match an
-- opportunity's agency to the people we know there. Idempotent and
-- additive.

CREATE TABLE IF NOT EXISTS "customer_contact" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"     uuid        NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "agency"              text        NOT NULL DEFAULT '',
  "agency_key"          text        NOT NULL DEFAULT '',
  "office"              text        NOT NULL DEFAULT '',
  "name"                text        NOT NULL,
  "title"               text        NOT NULL DEFAULT '',
  "role"                text        NOT NULL DEFAULT 'other',
  "email"               text        NOT NULL DEFAULT '',
  "phone"               text        NOT NULL DEFAULT '',
  "notes"               text        NOT NULL DEFAULT '',
  "owner_user_id"       text        REFERENCES "user"("id") ON DELETE SET NULL,
  "last_touch_at"       timestamp,
  "next_touch_at"       timestamp,
  "touch_count"         integer     NOT NULL DEFAULT 0,
  "created_by_user_id"  text        REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at"          timestamp   NOT NULL DEFAULT now(),
  "updated_at"          timestamp   NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_contact_org_agency_idx" ON "customer_contact" ("organization_id", "agency_key");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_touch" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"     uuid        NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "contact_id"          uuid        NOT NULL REFERENCES "customer_contact"("id") ON DELETE CASCADE,
  "kind"                text        NOT NULL DEFAULT 'note',
  "occurred_at"         timestamp   NOT NULL DEFAULT now(),
  "summary"             text        NOT NULL DEFAULT '',
  "opportunity_id"      uuid        REFERENCES "opportunity"("id") ON DELETE SET NULL,
  "next_touch_at"       timestamp,
  "logged_by_user_id"   text        REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at"          timestamp   NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customer_touch_org_contact_idx" ON "customer_touch" ("organization_id", "contact_id", "occurred_at");
