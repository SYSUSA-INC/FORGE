ALTER TABLE "knowledge_entry" ADD COLUMN IF NOT EXISTS "embedding" vector(1536);--> statement-breakpoint
ALTER TABLE "knowledge_entry" ADD COLUMN IF NOT EXISTS "embedded_at" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_entry_embedding_cosine_idx" ON "knowledge_entry" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 50);
