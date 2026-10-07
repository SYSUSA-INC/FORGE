-- BL-AIX Phase 1e-1 — the extraction gold set.
--
-- Public SAM.gov RFPs annotated with what a correct extraction must find:
-- requirements, page limits and Section M evaluation factors. FORGE drafts
-- the annotations and the owner's proposal expert reviews each one. Used
-- only to measure extraction accuracy, never trained on, and holding no
-- tenant data, so these are platform tables with no organization_id
-- (managed under /admin by platform admins). Idempotent, additive.

CREATE TABLE IF NOT EXISTS "extraction_gold_doc" (
  "id"                   uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title"                text        NOT NULL,
  "notice_id"            text        NOT NULL DEFAULT '',
  "solicitation_number"  text        NOT NULL DEFAULT '',
  "source_url"           text        NOT NULL DEFAULT '',
  "files"                jsonb       NOT NULL DEFAULT '[]'::jsonb,
  "raw_text"             text        NOT NULL DEFAULT '',
  "status"               text        NOT NULL DEFAULT 'draft',
  "notes"                text        NOT NULL DEFAULT '',
  "created_by_user_id"   text        REFERENCES "user"("id") ON DELETE SET NULL,
  "approved_by_user_id"  text        REFERENCES "user"("id") ON DELETE SET NULL,
  "approved_at"          timestamptz,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "extraction_gold_item" (
  "id"                   uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "doc_id"               uuid        NOT NULL REFERENCES "extraction_gold_doc"("id") ON DELETE CASCADE,
  "kind"                 text        NOT NULL,
  "ref"                  text        NOT NULL DEFAULT '',
  "text"                 text        NOT NULL,
  "value"                text        NOT NULL DEFAULT '',
  "position"             integer     NOT NULL DEFAULT 0,
  "origin"               text        NOT NULL DEFAULT 'expert',
  "status"               text        NOT NULL DEFAULT 'proposed',
  "reviewed_by_user_id"  text        REFERENCES "user"("id") ON DELETE SET NULL,
  "reviewed_at"          timestamptz,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  "updated_at"           timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "extraction_gold_doc_notice_idx" ON "extraction_gold_doc" ("notice_id") WHERE "notice_id" <> '';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "extraction_gold_item_doc_idx" ON "extraction_gold_item" ("doc_id", "kind", "position");
