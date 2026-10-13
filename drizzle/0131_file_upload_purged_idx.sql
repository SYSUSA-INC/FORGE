-- BL-STAB-2d — an index for the upload sweeper's last step.
--
-- The jobs cron (every five minutes) removes ledger rows 90 days after
-- their object was deleted. Rows a record keeps are never deleted, so the
-- table only grows; without this index that step reads all of it on every
-- tick. Partial: only rows whose object is gone. Additive, idempotent.

CREATE INDEX IF NOT EXISTS "file_upload_purged_idx" ON "file_upload" USING btree ("purged_at") WHERE "purged_at" IS NOT NULL;
