-- BL-AIX Phase 1g-2 — nightly AI work through Anthropic's Message Batches
-- API (half the token price, results within 24 hours).
--
-- ai_batch: one tenant's requests submitted as one batch. Tenant-scoped:
-- a batch never mixes organizations. The jobs cron reads finished batches
-- and applies each result under the batch's own organization.
-- ai_call_log.batched: the row was served through a batch.
-- scout_candidate.triage_batch_id: the batch a candidate's triage waits on.
-- Idempotent, additive.

CREATE TABLE IF NOT EXISTS "ai_batch" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "feature" text NOT NULL,
  "prompt_version" text DEFAULT '' NOT NULL,
  "provider" text DEFAULT 'anthropic' NOT NULL,
  "external_id" text NOT NULL,
  "status" text DEFAULT 'submitted' NOT NULL,
  "requests" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "context" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "succeeded" integer DEFAULT 0 NOT NULL,
  "failed" integer DEFAULT 0 NOT NULL,
  "error" text,
  "submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
  "checked_at" timestamp with time zone,
  "processed_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_batch" ADD CONSTRAINT "ai_batch_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_batch_org_submitted_idx" ON "ai_batch" USING btree ("organization_id", "submitted_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_batch_status_checked_idx" ON "ai_batch" USING btree ("status", "checked_at");
--> statement-breakpoint
ALTER TABLE "ai_call_log" ADD COLUMN IF NOT EXISTS "batched" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "scout_candidate" ADD COLUMN IF NOT EXISTS "triage_batch_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "scout_candidate" ADD CONSTRAINT "scout_candidate_triage_batch_id_ai_batch_id_fk" FOREIGN KEY ("triage_batch_id") REFERENCES "public"."ai_batch"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
