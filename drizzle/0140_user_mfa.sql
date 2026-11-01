-- BL-STAB-8a-1 — second factors and recovery codes per user, and the
-- user columns the gate (8a-2) reads. Idempotent and additive.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "mfa_enrolled_at" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "session_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "mfa_reset_at" timestamp;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_mfa_factor" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text DEFAULT 'totp' NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"secret_ciphertext" text,
	"secret_key_id" text DEFAULT '' NOT NULL,
	"last_used_step" integer,
	"credential_id" text,
	"public_key" text,
	"counter" integer DEFAULT 0 NOT NULL,
	"transports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confirmed_at" timestamp,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "user_mfa_factor" ADD CONSTRAINT "user_mfa_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_mfa_factor_user_idx" ON "user_mfa_factor" USING btree ("user_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_recovery_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "user_recovery_code" ADD CONSTRAINT "user_recovery_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_recovery_code_user_idx" ON "user_recovery_code" USING btree ("user_id");
