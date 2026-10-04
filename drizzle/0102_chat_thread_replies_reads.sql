-- BL-FB-CHAT-MULTI Slice 2 — the section thread grows up.
--
-- * reply_to_message_id: a note or question can answer an earlier
--   message of the same thread; cleared if the parent is deleted.
-- * section_chat_read: when each member last looked at a section's
--   thread, one row per (section, user), so the editor can say
--   "3 new since you looked" and badge the section header.
-- * chat_notes_to_model: whether the chat model reads the team's notes
--   on a section as context. Off by default — notes are for people.
--
-- Idempotent and additive.

ALTER TABLE "section_chat_message" ADD COLUMN IF NOT EXISTS "reply_to_message_id" uuid REFERENCES "section_chat_message"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "proposal_section" ADD COLUMN IF NOT EXISTS "chat_notes_to_model" boolean NOT NULL DEFAULT false;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "section_chat_read" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "section_id"      uuid NOT NULL REFERENCES "proposal_section"("id") ON DELETE CASCADE,
  "user_id"         text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "last_read_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "scr_section_user_idx" ON "section_chat_read" ("section_id", "user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "scr_org_user_idx" ON "section_chat_read" ("organization_id", "user_id");
