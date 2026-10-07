-- BL-AIX Phase 1i-2 — candidate-model eval runs.
--
-- requested_model: the model a run was asked to use ("" = the routed
-- default). On extraction_eval_run it covers the requirement sweep and
-- the review, so every resumed step uses the same model; on ai_eval_run
-- it covers the drafter only (the rubric judge keeps its own routing so
-- runs on different candidates stay comparable). Idempotent, additive.

ALTER TABLE "extraction_eval_run" ADD COLUMN IF NOT EXISTS "requested_model" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_eval_run" ADD COLUMN IF NOT EXISTS "requested_model" text DEFAULT '' NOT NULL;
