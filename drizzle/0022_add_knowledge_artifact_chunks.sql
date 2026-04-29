CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "knowledge_artifact_chunk" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"artifact_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"token_count" integer DEFAULT 0 NOT NULL,
	"char_start" integer DEFAULT 0 NOT NULL,
	"char_end" integer DEFAULT 0 NOT NULL,
	"embedding_provider" text DEFAULT '' NOT NULL,
	"embedding_model" text DEFAULT '' NOT NULL,
	"embedded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_artifact_chunk" ADD CONSTRAINT "knowledge_artifact_chunk_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_artifact_chunk" ADD CONSTRAINT "knowledge_artifact_chunk_artifact_id_knowledge_artifact_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."knowledge_artifact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_artifact_chunk_artifact_id_idx" ON "knowledge_artifact_chunk" ("artifact_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_artifact_chunk_organization_id_idx" ON "knowledge_artifact_chunk" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_artifact_chunk_embedding_cosine_idx" ON "knowledge_artifact_chunk" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
