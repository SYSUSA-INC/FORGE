-- BL-FB-CM-EVIDENCE — per-row evidence linking for compliance items
--
-- Each compliance item can have N evidence rows, each pointing at one
-- of three sources:
--   - past_performance:    an entry in organization.past_performance (by stable id)
--   - knowledge_entry:     a row in knowledge_entry (by uuid)
--   - section_paragraph:   a paragraph from a proposal_section (by section uuid)
--
-- For deletion safety, the label + snippet at attach time are cached on
-- the link row. That way the matrix exports correctly even if the
-- referenced entry is later edited or removed.

CREATE TYPE "compliance_evidence_kind" AS ENUM (
  'past_performance',
  'knowledge_entry',
  'section_paragraph'
);

CREATE TABLE "compliance_item_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "compliance_item_id" uuid NOT NULL REFERENCES "compliance_item"("id") ON DELETE CASCADE,
  "kind" "compliance_evidence_kind" NOT NULL,
  "ref_id" text NOT NULL DEFAULT '',
  "label" text NOT NULL DEFAULT '',
  "snippet" text NOT NULL DEFAULT '',
  "created_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "compliance_item_evidence_item_idx"
  ON "compliance_item_evidence" ("compliance_item_id");

CREATE INDEX "compliance_item_evidence_org_idx"
  ON "compliance_item_evidence" ("organization_id");
