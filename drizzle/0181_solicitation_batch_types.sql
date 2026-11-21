-- BL-STAB-3 — New Solicitation takes several files at once and files each
-- by what it is (owner decisions, 2026-10-21). Q&A files, pricing sheets
-- and forms get their own companion document types: pricing sheets and
-- forms are stored and readable but never swept for requirements; a Q&A
-- file's answers are read into solicitation_qa and carry the document
-- they came from, so they are removed with their file. Additive,
-- idempotent.
ALTER TYPE "public"."solicitation_document_type" ADD VALUE IF NOT EXISTS 'qa';--> statement-breakpoint
ALTER TYPE "public"."solicitation_document_type" ADD VALUE IF NOT EXISTS 'pricing';--> statement-breakpoint
ALTER TYPE "public"."solicitation_document_type" ADD VALUE IF NOT EXISTS 'form';--> statement-breakpoint
ALTER TABLE "solicitation_qa" ADD COLUMN IF NOT EXISTS "source_document_id" uuid REFERENCES "solicitation_document"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "solicitation_qa_source_document_idx" ON "solicitation_qa" ("source_document_id");
