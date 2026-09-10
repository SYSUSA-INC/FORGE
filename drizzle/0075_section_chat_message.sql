-- BL-FB-CHAT-PERSIST — persisted AI-assist chat thread per proposal section.
--
-- The section chat used to live only in the browser: close the panel and
-- the conversation was gone, and the model saw only whatever turns the
-- client chose to send back. Each turn (user question, assistant reply)
-- is now a row keyed by section, so reopening a section resumes the
-- thread and the server, not the client, decides what history the model
-- sees. Lives apart from proposal comment threads so AI conversations do
-- not clutter human review streams. Foundation for BL-FB-CHAT-MULTI.

CREATE TABLE IF NOT EXISTS "section_chat_message" (
  "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"  uuid        NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "proposal_id"      uuid        NOT NULL REFERENCES "proposal"("id") ON DELETE CASCADE,
  "section_id"       uuid        NOT NULL REFERENCES "proposal_section"("id") ON DELETE CASCADE,
  "user_id"          text        REFERENCES "user"("id") ON DELETE SET NULL,
  "role"             text        NOT NULL,
  "content"          text        NOT NULL,
  "stubbed"          boolean     NOT NULL DEFAULT false,
  "created_at"       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "scm_section_created_idx"
  ON "section_chat_message" ("section_id", "created_at");

CREATE INDEX IF NOT EXISTS "scm_org_created_idx"
  ON "section_chat_message" ("organization_id", "created_at" DESC);
