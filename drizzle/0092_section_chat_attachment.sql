-- BL-FB-CHAT-UPLOAD — documents dropped into a section's chat.
--
-- A writer can hand the section chat a sample SOW, a capability brief
-- or a prior proposal and say "model my Technical Approach on this
-- structure". The file's extracted text lives here, scoped to the
-- section's conversation (it goes to the model as reference, never to
-- the Brain) until the author explicitly saves it to Knowledge, which
-- records the created artifact. Clearing the chat removes the
-- attachments too. Every row carries organization_id. Idempotent and
-- additive.

CREATE TABLE IF NOT EXISTS "section_chat_attachment" (
  "id"                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"    uuid        NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "proposal_id"        uuid        NOT NULL REFERENCES "proposal"("id") ON DELETE CASCADE,
  "section_id"         uuid        NOT NULL REFERENCES "proposal_section"("id") ON DELETE CASCADE,
  "user_id"            text        REFERENCES "user"("id") ON DELETE SET NULL,
  "file_name"          text        NOT NULL DEFAULT '',
  "content_type"       text        NOT NULL DEFAULT '',
  "file_size"          integer     NOT NULL DEFAULT 0,
  "text"               text        NOT NULL DEFAULT '',
  "chars"              integer     NOT NULL DEFAULT 0,
  "saved_artifact_id"  uuid        REFERENCES "knowledge_artifact"("id") ON DELETE SET NULL,
  "created_at"         timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sca_org_section_idx" ON "section_chat_attachment" ("organization_id", "section_id");
