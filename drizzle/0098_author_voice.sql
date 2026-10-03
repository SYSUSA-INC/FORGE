-- BL-FB-GEN-VOICE Slice 1 — each author's writing voice, learned from
-- their own sections and pasted samples, as the measured profile the
-- drafter and chat write to. One profile per (organization, user); the
-- samples are the pasted texts (sections are read live at rebuild).
-- Both tables carry organization_id. Idempotent and additive.

CREATE TABLE IF NOT EXISTS "author_voice_profile" (
  "id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"   uuid        NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id"           text        NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "enabled"           boolean     NOT NULL DEFAULT true,
  "metrics"           jsonb,
  "traits"            jsonb       NOT NULL DEFAULT '[]'::jsonb,
  "guidance"          text        NOT NULL DEFAULT '',
  "custom_guidance"   text        NOT NULL DEFAULT '',
  "sample_count"      integer     NOT NULL DEFAULT 0,
  "sample_words"      integer     NOT NULL DEFAULT 0,
  "built_at"          timestamp,
  "created_at"        timestamp   NOT NULL DEFAULT now(),
  "updated_at"        timestamp   NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "author_voice_profile_org_user_idx" ON "author_voice_profile" ("organization_id", "user_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "author_voice_sample" (
  "id"                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id"   uuid        NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "user_id"           text        NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "source"            text        NOT NULL DEFAULT 'pasted',
  "title"             text        NOT NULL DEFAULT '',
  "text"              text        NOT NULL,
  "words"             integer     NOT NULL DEFAULT 0,
  "created_at"        timestamp   NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "author_voice_sample_org_user_idx" ON "author_voice_sample" ("organization_id", "user_id");
