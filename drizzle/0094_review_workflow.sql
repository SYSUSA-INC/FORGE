-- BL-FB-X-COLOR-TEAM Slice 1 — colour-team review workflow: the lead's
-- instructions and the round's own copy of the colour's checklist on
-- proposal_review; reviewers scoped to several sections (the legacy
-- single section_id mirrors the first); checklist ticks per reviewer;
-- Green Team (pricing) as a colour. Scoped through review → proposal →
-- organization like the other review tables. Idempotent and additive.
-- `ALTER TYPE ... ADD VALUE` stands alone: nothing below references it.
ALTER TYPE "review_color" ADD VALUE IF NOT EXISTS 'green';--> statement-breakpoint
ALTER TABLE "proposal_review" ADD COLUMN IF NOT EXISTS "instructions" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "proposal_review" ADD COLUMN IF NOT EXISTS "checklist" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposal_review_section_assignment" (
  "review_id"   uuid        NOT NULL REFERENCES "proposal_review"("id") ON DELETE CASCADE,
  "user_id"     text        NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "section_id"  uuid        NOT NULL REFERENCES "proposal_section"("id") ON DELETE CASCADE,
  "created_at"  timestamp   NOT NULL DEFAULT now(),
  PRIMARY KEY ("review_id", "user_id", "section_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proposal_review_section_assignment_section_idx" ON "proposal_review_section_assignment" ("review_id", "section_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "proposal_review_checklist_item" (
  "id"          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "review_id"   uuid        NOT NULL REFERENCES "proposal_review"("id") ON DELETE CASCADE,
  "user_id"     text        NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "item_key"    text        NOT NULL,
  "checked"     boolean     NOT NULL DEFAULT false,
  "note"        text        NOT NULL DEFAULT '',
  "updated_at"  timestamp   NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "proposal_review_checklist_item_unique_idx" ON "proposal_review_checklist_item" ("review_id", "user_id", "item_key");
