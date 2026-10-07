-- BL-AIX Phase 1h-1 — the Brain retrieval eval.
--
-- retrieval_eval_run: one run per tenant. Sections of the tenant's own
-- won proposals are searched the way the drafter searches, and scored by
-- whether their winning text comes back (recall at 1, 3 and 8; mean
-- reciprocal rank), per query mode, with the ranking revision and the
-- embedding provider it ran on. Tenant-scoped; idempotent, additive.

CREATE TABLE IF NOT EXISTS "retrieval_eval_run" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "retrieval_version" text DEFAULT '' NOT NULL,
  "embedding_provider" text DEFAULT '' NOT NULL,
  "case_count" integer DEFAULT 0 NOT NULL,
  "summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "results" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "stubbed" boolean DEFAULT false NOT NULL,
  "requested_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "retrieval_eval_run" ADD CONSTRAINT "retrieval_eval_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "retrieval_eval_run" ADD CONSTRAINT "retrieval_eval_run_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "retrieval_eval_run_org_created_idx" ON "retrieval_eval_run" USING btree ("organization_id", "created_at");
