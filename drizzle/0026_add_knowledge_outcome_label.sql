CREATE TYPE "public"."knowledge_outcome_label" AS ENUM('none', 'won', 'lost', 'no_bid', 'withdrawn');--> statement-breakpoint
ALTER TABLE "knowledge_artifact" ADD COLUMN "outcome_label" "knowledge_outcome_label" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_entry" ADD COLUMN "outcome_label" "knowledge_outcome_label" DEFAULT 'none' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_artifact_outcome_label_idx" ON "knowledge_artifact" ("outcome_label");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_entry_outcome_label_idx" ON "knowledge_entry" ("outcome_label");--> statement-breakpoint
-- Backfill: tag harvested artifacts with their proposal outcome.
UPDATE "knowledge_artifact" ka
SET "outcome_label" = po."outcome_type"::text::"knowledge_outcome_label"
FROM "proposal_outcome" po
WHERE ka."metadata" ->> 'proposalId' = po."proposal_id"::text
  AND ka."source" = 'mined_from_proposal'
  AND ka."outcome_label" = 'none';--> statement-breakpoint
-- Backfill: propagate outcome label down to entries promoted from those artifacts.
UPDATE "knowledge_entry" ke
SET "outcome_label" = ka."outcome_label"
FROM "knowledge_extraction_candidate" kec
JOIN "knowledge_artifact" ka ON ka."id" = kec."artifact_id"
WHERE kec."promoted_entry_id" = ke."id"
  AND ka."outcome_label" != 'none'
  AND ke."outcome_label" = 'none';
