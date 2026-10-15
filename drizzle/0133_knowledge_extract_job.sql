-- BL-STAB-2e — knowledge files are read by a durable job.
--
-- A knowledge-base upload used to carry the file inside the server action
-- (50 MB cap) and read it in the same request: a timeout or a deploy left
-- the artifact at "extracting" for good. Files now go straight to storage,
-- and their text extraction is a `background_job` of this kind, retried
-- by the jobs cron. Idempotent, additive.

ALTER TYPE "background_job_kind" ADD VALUE IF NOT EXISTS 'knowledge_artifact_extract';
