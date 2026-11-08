-- BL-SCOUT-INBOX phase 1 — a company's bid email address and the emails
-- portals send to it. FORGE receives mail for its inbound domain through
-- Postmark; each email is stored once (by its provider message id) with
-- its sender authentication, a text preview, its links and its
-- attachments' names, the raw payload in storage. Reading the bids into
-- Scout finds is phase 2. Idempotent and additive.

DO $$ BEGIN
  CREATE TYPE "inbound_email_kind" AS ENUM ('unknown', 'bid_alert', 'account', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "inbound_email_status" AS ENUM ('received', 'parsed', 'failed', 'ignored');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "inbound_address" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "local_part" text NOT NULL,
  "domain" text DEFAULT '' NOT NULL,
  "created_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "disabled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_address_org_idx" ON "inbound_address" ("organization_id", "created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inbound_address_local_domain_uidx" ON "inbound_address" ("local_part", "domain");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "inbound_email" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "address_id" uuid REFERENCES "inbound_address"("id") ON DELETE SET NULL,
  "provider" text DEFAULT 'postmark' NOT NULL,
  "provider_message_id" text NOT NULL,
  "from_address" text DEFAULT '' NOT NULL,
  "from_name" text DEFAULT '' NOT NULL,
  "to_address" text DEFAULT '' NOT NULL,
  "subject" text DEFAULT '' NOT NULL,
  "text_preview" text DEFAULT '' NOT NULL,
  "links" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "spf" text DEFAULT '' NOT NULL,
  "dkim" text DEFAULT '' NOT NULL,
  "authenticated" boolean DEFAULT false NOT NULL,
  "kind" "inbound_email_kind" DEFAULT 'unknown' NOT NULL,
  "status" "inbound_email_status" DEFAULT 'received' NOT NULL,
  "storage_path" text DEFAULT '' NOT NULL,
  "raw_size" integer DEFAULT 0 NOT NULL,
  "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "bids_found" integer DEFAULT 0 NOT NULL,
  "error" text DEFAULT '' NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_email_org_received_idx" ON "inbound_email" ("organization_id", "received_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "inbound_email_provider_msg_uidx" ON "inbound_email" ("organization_id", "provider", "provider_message_id");
