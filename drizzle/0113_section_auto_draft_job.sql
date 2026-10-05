-- BL-AIX Phase 0c — auto-draft runs on the server.
--
-- "Auto-draft proposal" used to be a loop in the browser: closing the
-- dialog stopped it, and every section's draft was written straight over
-- the body. Each section is now a durable `background_job` of this kind,
-- picked up by the jobs cron if the page that started it goes away.
-- Idempotent, additive.

ALTER TYPE "background_job_kind" ADD VALUE IF NOT EXISTS 'section_auto_draft';
