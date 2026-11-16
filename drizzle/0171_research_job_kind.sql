-- BL-NAV-LIFECYCLE 5b — the research step before "draft all sections": one durable job per proposal.
-- A new enum value goes in its own migration file. Idempotent, additive.

ALTER TYPE "background_job_kind" ADD VALUE IF NOT EXISTS 'proposal_research';
