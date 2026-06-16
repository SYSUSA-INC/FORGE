-- BL-9 Slice 1 — Yjs document persistence for the collab editor.
--
-- Holds the latest binary state of each collaboratively-edited
-- document (one row per (organization_id, doc_name) pair). The
-- Hocuspocus service in services/collab/ reads from this table on
-- document load and rewrites the `state` column on debounce after
-- every commit.
--
-- See docs/architecture/collab-editor.md for the full design.
--
-- Tenant scoping: every row carries `organization_id`. The
-- Hocuspocus `onAuthenticate` hook refuses any doc_name whose row's
-- org doesn't match the JWT's org claim.
--
-- Data shape: `state` is `Y.encodeStateAsUpdate(ydoc)` — a full
-- snapshot of the doc, not an append-only delta stream. We trust Yjs's
-- internal log to track edit history; if we need cross-version diffs
-- (Slice 5+), we'll add a `yjs_doc_snapshot` sibling table.
--
-- The existing `proposal_section.body_doc` ProseMirror JSON column
-- stays as the canonical persisted form for non-collab readers
-- (PDF render, share-link, export). Slice 2 wires a projection
-- writeback so body_doc stays in sync with the Yjs doc.

CREATE TABLE "yjs_doc" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "doc_name" text NOT NULL,
  "state" bytea NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

-- One row per (org, doc) pair. Hocuspocus upserts on this constraint.
CREATE UNIQUE INDEX "yjs_doc_org_name_uq"
  ON "yjs_doc" ("organization_id", "doc_name");

-- Powers "recently-edited docs" admin views in later slices and lets
-- a cleanup job find stale rows efficiently.
CREATE INDEX "yjs_doc_org_updated_idx"
  ON "yjs_doc" ("organization_id", "updated_at" DESC);
