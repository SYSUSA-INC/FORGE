-- BL-AIP-4 — swap the pgvector indexes from IVFFlat to HNSW.
--
-- The IVFFlat indexes (0022, 0023) were built on empty tables, so their
-- list centroids were never trained on real data, no `probes` setting
-- was ever applied, and the tenant filter runs after the approximate
-- scan — recall for one tenant's slice of a shared table was poor.
-- HNSW needs no training step, builds incrementally as rows arrive and
-- gives better recall at the same latency for tables this size.
--
-- New names (…_hnsw_idx) so the drop and the create are distinct
-- objects; src/db/schema.ts mirrors the new names (check-schema-drift).
-- DROP INDEX is not on the runner's destructive list: it is recoverable
-- by re-creating, which is exactly what the next statement does.
-- Idempotent.

DROP INDEX IF EXISTS "knowledge_artifact_chunk_embedding_cosine_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_artifact_chunk_embedding_hnsw_idx" ON "knowledge_artifact_chunk" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);--> statement-breakpoint
DROP INDEX IF EXISTS "knowledge_entry_embedding_cosine_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_entry_embedding_hnsw_idx" ON "knowledge_entry" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);
