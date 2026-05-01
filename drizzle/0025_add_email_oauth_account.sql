CREATE TYPE "public"."email_oauth_provider" AS ENUM('google', 'microsoft');--> statement-breakpoint
CREATE TABLE "email_oauth_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"provider" "email_oauth_provider" NOT NULL,
	"email_address" text NOT NULL,
	"access_token_encrypted" text NOT NULL,
	"refresh_token_encrypted" text DEFAULT '' NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"token_expires_at" timestamp,
	"is_default" boolean DEFAULT false NOT NULL,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"last_error" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_oauth_account" ADD CONSTRAINT "email_oauth_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_oauth_account_user_id_idx" ON "email_oauth_account" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "email_oauth_account_user_provider_email_unique" ON "email_oauth_account" ("user_id", "provider", "email_address");
