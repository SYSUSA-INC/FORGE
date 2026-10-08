-- BL-STAB-2b — the upload ledger.
--
-- Browsers now upload files straight to storage (R2) through short-lived
-- presigned links instead of posting them through a server action, which
-- capped every upload at the host's request size. file_upload records
-- every object key the server signs: who asked, for what purpose, what
-- was declared, what was found in storage, and which record claimed it.
-- The key is built on the server from the organization and the row id,
-- so it never holds client input. One row per upload; the status moves
-- pending → stored → claiming → claimed (or failed / released), and
-- purge_after says when the object is due to be deleted (abandoned,
-- rejected, transient). Tenant-scoped; idempotent, additive.

CREATE TABLE IF NOT EXISTS "file_upload" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" uuid NOT NULL,
  "user_id" text,
  "purpose" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "transport" text DEFAULT 'direct' NOT NULL,
  "storage_key" text NOT NULL,
  "file_name" text NOT NULL,
  "declared_format" text NOT NULL,
  "detected_format" text DEFAULT '' NOT NULL,
  "content_type" text NOT NULL,
  "declared_size" bigint NOT NULL,
  "stored_size" bigint,
  "etag" text DEFAULT '' NOT NULL,
  "origin" text DEFAULT '' NOT NULL,
  "resource_type" text DEFAULT '' NOT NULL,
  "resource_id" uuid,
  "failure_reason" text DEFAULT '' NOT NULL,
  "failure_detail" text DEFAULT '' NOT NULL,
  "put_attempts" integer DEFAULT 0 NOT NULL,
  "purge_attempts" integer DEFAULT 0 NOT NULL,
  "url_expires_at" timestamp with time zone NOT NULL,
  "purge_after" timestamp with time zone,
  "stored_at" timestamp with time zone,
  "claimed_at" timestamp with time zone,
  "purged_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "file_upload" ADD CONSTRAINT "file_upload_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "file_upload" ADD CONSTRAINT "file_upload_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "file_upload_storage_key_idx" ON "file_upload" USING btree ("storage_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_upload_org_created_idx" ON "file_upload" USING btree ("organization_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_upload_org_user_status_idx" ON "file_upload" USING btree ("organization_id", "user_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_upload_org_resource_idx" ON "file_upload" USING btree ("organization_id", "resource_type", "resource_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "file_upload_purge_idx" ON "file_upload" USING btree ("purge_after") WHERE "purge_after" IS NOT NULL AND "purged_at" IS NULL;
