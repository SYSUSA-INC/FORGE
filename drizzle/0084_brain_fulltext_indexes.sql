-- BL-AIP-4b — hybrid Brain search.
--
-- Semantic search alone misses exact terms (a contract number, a
-- certification name, an agency acronym) and returns nothing useful in
-- stub-embedding mode. These GIN indexes back a Postgres full-text
-- query that runs beside the vector query; the two rankings are fused
-- (reciprocal rank fusion) in src/lib/brain-retrieval.ts. The
-- expressions here must match the queries exactly for the planner to
-- use the indexes. Idempotent and additive.

CREATE INDEX IF NOT EXISTS "knowledge_artifact_chunk_content_tsv_idx" ON "knowledge_artifact_chunk" USING gin (to_tsvector('english', "content"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_entry_text_tsv_idx" ON "knowledge_entry" USING gin (to_tsvector('english', "title" || ' ' || "body"));
