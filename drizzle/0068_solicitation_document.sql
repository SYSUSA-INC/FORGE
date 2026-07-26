-- BL-FB-SOL-BUNDLE — multi-document solicitation bundles.
--
-- A solicitation can now carry companion documents (PWS, SOW, CDRLs,
-- J-attachments) beyond the primary RFP file. Each companion document
-- is parsed independently; their requirements roll up (deduped) into
-- the parent solicitation's extractedRequirements so the AI context
-- always sees the full merged set without re-joining.

CREATE TYPE "solicitation_document_type" AS ENUM (
  'rfp',
  'pws',
  'sow',
  'cdrl',
  'j_attachment',
  'amendment',
  'other'
);

CREATE TABLE "solicitation_document" (
  "id"                      uuid      PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"         uuid      NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "solicitation_id"         uuid      NOT NULL REFERENCES "solicitation"("id") ON DELETE CASCADE,
  "document_type"           "solicitation_document_type" NOT NULL DEFAULT 'other',
  "file_name"               text      NOT NULL DEFAULT '',
  "file_size"               integer   NOT NULL DEFAULT 0,
  "content_type"            text      NOT NULL DEFAULT '',
  "storage_path"            text      NOT NULL DEFAULT '',
  "parse_status"            "solicitation_parse_status" NOT NULL DEFAULT 'uploaded',
  "parse_error"             text      NOT NULL DEFAULT '',
  "raw_text"                text      NOT NULL DEFAULT '',
  "section_l_summary"       text      NOT NULL DEFAULT '',
  "section_m_summary"       text      NOT NULL DEFAULT '',
  "extracted_requirements"  jsonb     NOT NULL DEFAULT '[]',
  "sort_order"              integer   NOT NULL DEFAULT 0,
  "uploaded_by_user_id"     text      REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at"              timestamptz NOT NULL DEFAULT now(),
  "updated_at"              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX "sol_doc_solicitation_idx"  ON "solicitation_document" ("solicitation_id");
CREATE INDEX "sol_doc_org_created_idx"   ON "solicitation_document" ("organization_id", "created_at" DESC);
