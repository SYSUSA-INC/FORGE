-- BL-23: AI document review + Capability Matrix + Question Generator.
--
-- Three new tables on top of the existing solicitation schema:
--   solicitation_review            -- the deep AI read; gates the next two
--   solicitation_capability_matrix -- joins review against knowledge entries
--   solicitation_question_set      -- categorized clarification questions
--
-- Each table is org-scoped (multi-tenant isolation) and references the
-- solicitation via FK with cascade. The matrix and question_set ALSO
-- reference solicitation_review so they're paired with the specific
-- review run that produced them; if a tenant re-runs the review, the
-- matrix and questions for that solicitation are replaced.

CREATE TYPE "solicitation_review_status" AS ENUM (
  'pending',
  'running',
  'complete',
  'failed'
);

-- ── solicitation_review ─────────────────────────────────────────────
CREATE TABLE "solicitation_review" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "solicitation_id" uuid NOT NULL REFERENCES "solicitation"("id") ON DELETE CASCADE,
  "status" "solicitation_review_status" NOT NULL DEFAULT 'pending',
  -- Full structured AI output: requirements, evaluation factors,
  -- capability buckets, period of performance, place of performance,
  -- security/clearance, set-aside details, open questions surfaced
  -- during the review.
  "result" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Failure reason if status = failed.
  "error" text NOT NULL DEFAULT '',
  "model" text NOT NULL DEFAULT '',
  "stubbed" boolean NOT NULL DEFAULT false,
  "created_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "completed_at" timestamp,
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- One review row per (org, solicitation). Re-running upserts.
CREATE UNIQUE INDEX "solicitation_review_org_solicitation_uq"
  ON "solicitation_review" ("organization_id", "solicitation_id");

CREATE INDEX "solicitation_review_status_idx"
  ON "solicitation_review" ("organization_id", "status");

-- ── solicitation_capability_matrix ──────────────────────────────────
CREATE TABLE "solicitation_capability_matrix" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "solicitation_id" uuid NOT NULL REFERENCES "solicitation"("id") ON DELETE CASCADE,
  "solicitation_review_id" uuid NOT NULL REFERENCES "solicitation_review"("id") ON DELETE CASCADE,
  -- Cell-level scoring: each cell is { requirementId, capabilityRef,
  -- status: 'strong'|'partial'|'gap'|'not_addressed', citation, narrative }.
  "cells" jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- PWin recommendation range derived from cell coverage + scoring.
  "pwin_recommendation_low" integer NOT NULL DEFAULT 0,
  "pwin_recommendation_high" integer NOT NULL DEFAULT 0,
  "model" text NOT NULL DEFAULT '',
  "stubbed" boolean NOT NULL DEFAULT false,
  "created_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- One matrix per solicitation (re-runs UPSERT on the existing row).
CREATE UNIQUE INDEX "solicitation_capability_matrix_org_solicitation_uq"
  ON "solicitation_capability_matrix" ("organization_id", "solicitation_id");

-- ── solicitation_question_set ───────────────────────────────────────
CREATE TABLE "solicitation_question_set" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "solicitation_id" uuid NOT NULL REFERENCES "solicitation"("id") ON DELETE CASCADE,
  "solicitation_review_id" uuid NOT NULL REFERENCES "solicitation_review"("id") ON DELETE CASCADE,
  -- Each question: { category, text, rationale, sectionRef }.
  -- Categories match the prompt: scope_ambiguity, evaluation_criteria,
  -- submission_logistics, technical_constraints,
  -- security_clearance, subcontracting.
  "questions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "model" text NOT NULL DEFAULT '',
  "stubbed" boolean NOT NULL DEFAULT false,
  "created_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- One question set per solicitation (re-runs UPSERT).
CREATE UNIQUE INDEX "solicitation_question_set_org_solicitation_uq"
  ON "solicitation_question_set" ("organization_id", "solicitation_id");
