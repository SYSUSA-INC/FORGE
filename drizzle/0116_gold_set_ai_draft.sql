-- BL-AIX Phase 1e-2 — AI-drafted gold-set annotations.
--
-- extraction_gold_doc.ai_draft: how far the AI draft of a document's
-- annotations has read (characters done, windows done and failed,
-- annotations proposed and skipped as duplicates), with the model and
-- prompt version that drafted them. Empty until a draft is started.
-- Idempotent, additive.

ALTER TABLE "extraction_gold_doc" ADD COLUMN IF NOT EXISTS "ai_draft" jsonb NOT NULL DEFAULT '{}'::jsonb;
