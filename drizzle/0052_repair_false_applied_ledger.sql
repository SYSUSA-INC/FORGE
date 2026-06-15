-- BL-QC-schema-repair — repair false-applied ledger state from 2026-06-15.
--
-- WHAT HAPPENED
--
-- On 2026-06-15, /admin/orgs/[id] and /admin started returning 500 with
-- Postgres error 42P01 "relation `audit_log` does not exist" (and
-- similar for 6 other tables). The `_forge_migration` ledger said
-- migrations 0028, 0031, 0032, 0033, 0034 were applied, but the tables
-- those migrations create were missing. Migrations 0035+ HAD applied
-- (the table renames in 0036 worked, proving cert_firm existed), so
-- the database wasn't simply behind — it was in a partial state
-- where the ledger lied about earlier applies.
--
-- ROOT CAUSE
--
-- Most likely: at some point earlier, someone clicked the "Sync ledger"
-- affordance on /admin/migrations (the "orphan candidates" panel from
-- MigrationsClient.tsx, lines 73-162). That affordance marks ledger
-- entries as applied via markMigrationsAppliedThrough() WITHOUT
-- running the SQL — designed for the case where a DB was migrated
-- via scripts/apply-schema.mjs BEFORE the runtime ledger existed.
-- It was applied past the actual high-water mark, marking 0028-0034
-- as applied when their tables didn't yet exist.
--
-- WHAT THIS MIGRATION DOES
--
-- Re-creates the 7 missing tables idempotently. Every CREATE TABLE
-- uses `IF NOT EXISTS`; every CREATE TYPE uses a DO block with
-- EXCEPTION WHEN duplicate_object; every ALTER TABLE ADD CONSTRAINT
-- uses a DO block. Safe to apply anywhere — production where the
-- 2026-06-15 hotfix SQL already created the tables (this migration
-- no-ops), and fresh deploys / restored backups (this migration
-- creates them).
--
-- The content mirrors migrations 0028, 0031, 0032, 0033, 0034 but
-- adapted for idempotency. The original files stay untouched per the
-- migration immutability rule.
--
-- PREVENTION
--
-- Follow-up PR will harden the migration runner to:
--   1. Detect ledger drift on boot (ledger entries whose target tables
--      don't exist).
--   2. Replace the "Sync ledger" UI with a safer, per-file affordance.

-- ── 0028 repair: proposal_winner_analysis ───────────────────────────
CREATE TABLE IF NOT EXISTS "proposal_winner_analysis" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "proposal_id" uuid NOT NULL UNIQUE,
  "organization_id" uuid NOT NULL,
  "competitor_name" text NOT NULL DEFAULT '',
  "winner_profile_summary" text NOT NULL DEFAULT '',
  "gaps_we_had" text NOT NULL DEFAULT '',
  "our_strengths_unrecognized" text NOT NULL DEFAULT '',
  "recommendations" text NOT NULL DEFAULT '',
  "source_usaspending" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "model" text NOT NULL DEFAULT '',
  "stubbed" boolean NOT NULL DEFAULT false,
  "created_by_user_id" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE "proposal_winner_analysis"
    ADD CONSTRAINT "proposal_winner_analysis_proposal_id_fk"
    FOREIGN KEY ("proposal_id") REFERENCES "public"."proposal"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "proposal_winner_analysis"
    ADD CONSTRAINT "proposal_winner_analysis_organization_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "proposal_winner_analysis"
    ADD CONSTRAINT "proposal_winner_analysis_created_by_user_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ── 0031 repair: rate_limit_counter ─────────────────────────────────
CREATE TABLE IF NOT EXISTS "rate_limit_counter" (
  "key" text NOT NULL,
  "window_start" timestamp NOT NULL,
  "count" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "rate_limit_counter_pk" PRIMARY KEY ("key", "window_start")
);
CREATE INDEX IF NOT EXISTS "rate_limit_counter_updated_at_idx"
  ON "rate_limit_counter" ("updated_at");

-- ── 0032 repair: opportunity_source_request ─────────────────────────
DO $$ BEGIN
  CREATE TYPE "opportunity_source_request_status" AS ENUM (
    'pending', 'under_review', 'shipped', 'rejected'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "opportunity_source_request" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "requester_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "source_name" text NOT NULL DEFAULT '',
  "description" text NOT NULL DEFAULT '',
  "sample_text" text NOT NULL DEFAULT '',
  "status" "opportunity_source_request_status" NOT NULL DEFAULT 'pending',
  "platform_notes" text NOT NULL DEFAULT '',
  "status_changed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "opportunity_source_request_org_created_idx"
  ON "opportunity_source_request" ("organization_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "opportunity_source_request_status_created_idx"
  ON "opportunity_source_request" ("status", "created_at" DESC);

-- ── 0033 repair: solicitation_review + matrix + question_set ────────
DO $$ BEGIN
  CREATE TYPE "solicitation_review_status" AS ENUM (
    'pending', 'running', 'complete', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "solicitation_review" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "solicitation_id" uuid NOT NULL REFERENCES "solicitation"("id") ON DELETE CASCADE,
  "status" "solicitation_review_status" NOT NULL DEFAULT 'pending',
  "result" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "error" text NOT NULL DEFAULT '',
  "model" text NOT NULL DEFAULT '',
  "stubbed" boolean NOT NULL DEFAULT false,
  "created_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "completed_at" timestamp,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "solicitation_review_org_solicitation_uq"
  ON "solicitation_review" ("organization_id", "solicitation_id");
CREATE INDEX IF NOT EXISTS "solicitation_review_status_idx"
  ON "solicitation_review" ("organization_id", "status");

CREATE TABLE IF NOT EXISTS "solicitation_capability_matrix" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "solicitation_id" uuid NOT NULL REFERENCES "solicitation"("id") ON DELETE CASCADE,
  "solicitation_review_id" uuid NOT NULL REFERENCES "solicitation_review"("id") ON DELETE CASCADE,
  "cells" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "pwin_recommendation_low" integer NOT NULL DEFAULT 0,
  "pwin_recommendation_high" integer NOT NULL DEFAULT 0,
  "model" text NOT NULL DEFAULT '',
  "stubbed" boolean NOT NULL DEFAULT false,
  "created_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "solicitation_capability_matrix_org_solicitation_uq"
  ON "solicitation_capability_matrix" ("organization_id", "solicitation_id");

CREATE TABLE IF NOT EXISTS "solicitation_question_set" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "solicitation_id" uuid NOT NULL REFERENCES "solicitation"("id") ON DELETE CASCADE,
  "solicitation_review_id" uuid NOT NULL REFERENCES "solicitation_review"("id") ON DELETE CASCADE,
  "questions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "model" text NOT NULL DEFAULT '',
  "stubbed" boolean NOT NULL DEFAULT false,
  "created_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "solicitation_question_set_org_solicitation_uq"
  ON "solicitation_question_set" ("organization_id", "solicitation_id");

-- ── 0034 repair: audit_log ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "actor_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "actor_email_snapshot" text NOT NULL DEFAULT '',
  "action" text NOT NULL,
  "resource_type" text NOT NULL DEFAULT '',
  "resource_id" text NOT NULL DEFAULT '',
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "ip" text NOT NULL DEFAULT '',
  "user_agent" text NOT NULL DEFAULT '',
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "audit_log_org_created_idx"
  ON "audit_log" ("organization_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "audit_log_org_resource_idx"
  ON "audit_log" ("organization_id", "resource_type", "resource_id");
CREATE INDEX IF NOT EXISTS "audit_log_org_actor_idx"
  ON "audit_log" ("organization_id", "actor_user_id", "created_at" DESC);
