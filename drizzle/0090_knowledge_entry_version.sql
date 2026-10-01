-- BL-FB-GEN-BLOCKS — reusable content blocks with version history.
--
-- Boilerplate knowledge entries ("our cyber capability", "key personnel
-- intro", "transition risk methodology") are the org's content blocks:
-- insertable into any proposal section by tag from the editor, and
-- version-controlled with a changelog so "v3" means something. Every
-- save of an entry's title, body or tags appends a row here (the first
-- tracked save also records the pre-change state as v1); restoring an
-- older version writes the entry back and appends a new row. Every row
-- carries organization_id. Idempotent and additive.

CREATE TABLE IF NOT EXISTS "knowledge_entry_version" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"     uuid        NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "entry_id"            uuid        NOT NULL REFERENCES "knowledge_entry"("id") ON DELETE CASCADE,
  "version"             integer     NOT NULL,
  "title"               text        NOT NULL DEFAULT '',
  "body"                text        NOT NULL DEFAULT '',
  "tags"                text[]      NOT NULL DEFAULT ARRAY[]::text[],
  "change_note"         text        NOT NULL DEFAULT '',
  "words_added"         integer     NOT NULL DEFAULT 0,
  "words_removed"       integer     NOT NULL DEFAULT 0,
  "created_by_user_id"  text        REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at"          timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "knowledge_entry_version_entry_version_uq" ON "knowledge_entry_version" ("entry_id", "version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "knowledge_entry_version_org_entry_idx" ON "knowledge_entry_version" ("organization_id", "entry_id");
