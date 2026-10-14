-- BL-STAB-2d — at most one open job per record.
--
-- enqueueJob reused an open (queued or running) job by reading first and
-- inserting after, so two requests, or two runs of the jobs cron, at the
-- same moment could both insert, and the record was parsed twice. This
-- partial unique index makes the second insert a no-op: enqueueJob now
-- inserts ON CONFLICT DO NOTHING and reads the open job back.
--
-- Duplicates that already exist are closed first: per record, a running
-- job is kept over a queued one, then the oldest; the others are failed
-- with a note. Idempotent (no duplicates remain on a second run).

UPDATE "background_job"
SET "status" = 'failed',
    "error" = 'Closed as a duplicate of another open job for the same record (BL-STAB-2d).',
    "finished_at" = now(),
    "updated_at" = now()
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (
      PARTITION BY "organization_id", "kind", "resource_id"
      ORDER BY ("status" = 'running') DESC, "created_at" ASC
    ) AS "rn"
    FROM "background_job"
    WHERE "status" IN ('queued', 'running')
  ) AS "open_jobs"
  WHERE "open_jobs"."rn" > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "background_job_one_open_idx" ON "background_job" USING btree ("organization_id","kind","resource_id") WHERE "status" IN ('queued', 'running');
