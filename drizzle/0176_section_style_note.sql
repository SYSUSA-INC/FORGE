-- BL-NAV-LIFECYCLE 5d-2 — the style note: what a tenant's writers and
-- reviewers cut, add and prefer, per section kind. Rebuilt weekly from the
-- tenant's own edits (section_change_decision, the ai_draft snapshots) by
-- /api/cron/style-notes; read by the section drafter and shown on the AI
-- Draft Insights panel. One row per (tenant, section kind); never read
-- across tenants. Design: docs/design/BL-NAV-LIFECYCLE_PHASE5_DEVELOP.md §2.5.
-- Additive, idempotent.
CREATE TABLE IF NOT EXISTS "section_style_note" (
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "section_kind" text NOT NULL,
  "body" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "sample_size" integer NOT NULL DEFAULT 0,
  "built_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "section_style_note_pk" PRIMARY KEY ("organization_id", "section_kind")
);
