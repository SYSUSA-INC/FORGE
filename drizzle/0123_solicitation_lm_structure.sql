-- BL-AIX Phase 2b — Sections L and M as structured data.
--
-- lm_structure: what the dedicated Section L and Section M passes read
-- from the document at intake (volumes, page limits, format and
-- submission rules; award basis, factors in order with their importance
-- and subfactors), each item with the clause it came from and where it
-- sits. '{}' until the document is parsed or re-parsed. Idempotent,
-- additive.

ALTER TABLE "solicitation" ADD COLUMN IF NOT EXISTS "lm_structure" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "solicitation_document" ADD COLUMN IF NOT EXISTS "lm_structure" jsonb DEFAULT '{}'::jsonb NOT NULL;
