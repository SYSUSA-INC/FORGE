-- BL-25: BD intelligence suite — 8(a) participant registry, watchlist,
-- and saved searches.
--
-- Four tables in one migration because they're a cohesive unit and the
-- fresh-DB CI gate exercises them together.
--
--   sba_8a_participant  — reference data, GLOBAL (not tenant-scoped),
--                         populated by admin import from SAM.gov entity
--                         API (or manual CSV paste).
--   sba_8a_import_run   — audit trail for the import job.
--   bd_watchlist_item   — tenant-scoped saved awards/firms.
--   bd_saved_search     — tenant-scoped saved search criteria, with
--                         per-user ownership and an org-shared flag.

-- ── 8(a) participant registry ────────────────────────────────────────
CREATE TABLE "sba_8a_participant" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SAM UEI when known. Unique so re-imports upsert idempotently.
  -- May be the legal name slug for legacy rows without UEIs.
  "uei" text NOT NULL UNIQUE,
  "firm_name" text NOT NULL,
  -- Uppercased, punctuation-stripped firm name — match key for joining
  -- against USAspending recipient names when UEI lookup misses.
  "firm_name_norm" text NOT NULL DEFAULT '',
  "cert_entry_date" timestamp,
  "cert_exit_date" timestamp,
  -- 'active' | 'graduated' | 'terminated' | 'unknown'
  "status" text NOT NULL DEFAULT 'unknown',
  "naics_primary" text NOT NULL DEFAULT '',
  "city" text NOT NULL DEFAULT '',
  "state" text NOT NULL DEFAULT '',
  -- 'sam.gov' | 'data.sba.gov' | 'manual' — provenance for the row.
  "source" text NOT NULL DEFAULT '',
  "source_updated_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX "sba_8a_participant_name_norm_idx"
  ON "sba_8a_participant" ("firm_name_norm");

CREATE INDEX "sba_8a_participant_exit_date_idx"
  ON "sba_8a_participant" ("cert_exit_date");

-- ── 8(a) import run ──────────────────────────────────────────────────
CREATE TABLE "sba_8a_import_run" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "started_at" timestamp NOT NULL DEFAULT now(),
  "finished_at" timestamp,
  -- 'running' | 'ok' | 'failed'
  "status" text NOT NULL DEFAULT 'running',
  -- 'sam.gov' | 'data.sba.gov' | 'manual_csv'
  "source" text NOT NULL DEFAULT '',
  "rows_seen" integer NOT NULL DEFAULT 0,
  "rows_upserted" integer NOT NULL DEFAULT 0,
  "error" text NOT NULL DEFAULT ''
);

CREATE INDEX "sba_8a_import_run_started_idx"
  ON "sba_8a_import_run" ("started_at" DESC);

-- ── BD watchlist ─────────────────────────────────────────────────────
CREATE TABLE "bd_watchlist_item" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  -- Null when the user who saved this item has been removed from the
  -- org but the saved item should remain available to the rest of the
  -- team.
  "created_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  -- 'award' | 'firm'
  "kind" text NOT NULL,
  -- USAspending generated_internal_id for awards; UEI for firms. The
  -- (org, kind, external_id) tuple is unique so "save" is idempotent.
  "external_id" text NOT NULL,
  -- Human-readable snapshot for display when the upstream source is
  -- unreachable (e.g. USAspending outage).
  "label" text NOT NULL DEFAULT '',
  -- Fields cached at save-time (award amount, end date, agency, naics,
  -- 8(a) status snapshot, etc.). Display-only; not used as the
  -- source of truth.
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "notes" text NOT NULL DEFAULT '',
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX "bd_watchlist_item_org_kind_ext_idx"
  ON "bd_watchlist_item" ("organization_id", "kind", "external_id");

CREATE INDEX "bd_watchlist_item_org_kind_created_idx"
  ON "bd_watchlist_item" ("organization_id", "kind", "created_at" DESC);

-- ── BD saved searches ────────────────────────────────────────────────
CREATE TABLE "bd_saved_search" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  -- Saved searches belong to a user. If the user leaves the org, their
  -- private searches go with them; org-shared ones survive (the owner
  -- column drops to null via SET NULL, signalled as "ex-member" in UI).
  "created_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "name" text NOT NULL,
  -- 'awards' | 'firms'
  "kind" text NOT NULL,
  -- AwardsSearchCriteria or FirmsSearchCriteria, JSON-serialised.
  "criteria" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- When true, all members of the org see it. When false, only the
  -- creator sees it.
  "shared" boolean NOT NULL DEFAULT false,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "last_run_at" timestamp
);

CREATE INDEX "bd_saved_search_org_owner_idx"
  ON "bd_saved_search" ("organization_id", "created_by", "created_at" DESC);

CREATE INDEX "bd_saved_search_org_shared_idx"
  ON "bd_saved_search" ("organization_id", "shared", "created_at" DESC);
