-- BL-OPP-SOURCE (owner, 2026-11-07) — where an opportunity came from and a
-- link back to it: SAM.gov, GSA eBuy, a GSA email, a GWAC, a state, local,
-- commercial or prime portal, a portal email, a USAspending recompete, an
-- uploaded document, or by hand (the vocabulary is in
-- src/lib/opportunity-source.ts). Existing opportunities are filled in
-- from what FORGE already holds: a SAM.gov notice ID, the Scout find it
-- was added from, or the note an eBuy / GSA email paste or a document left.
-- Idempotent and additive: each backfill only touches rows still 'manual'
-- with no link.

ALTER TABLE "opportunity" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunity" ADD COLUMN IF NOT EXISTS "source_url" text DEFAULT '' NOT NULL;--> statement-breakpoint

-- A Scout find read from a portal email, or a USAspending recompete: its link.
UPDATE "opportunity" o
SET "source" = CASE c."source" WHEN 'portal_email' THEN 'portal_email' ELSE 'usaspending' END,
    "source_url" = CASE WHEN c."ui_link" ~* '^https?://' THEN left(c."ui_link", 2000) ELSE '' END
FROM "scout_candidate" c
WHERE c."opportunity_id" = o."id"
  AND c."organization_id" = o."organization_id"
  AND c."source" IN ('portal_email', 'watchlist_award')
  AND o."source" = 'manual' AND o."source_url" = '';--> statement-breakpoint

-- A SAM.gov notice: its public page.
UPDATE "opportunity"
SET "source" = 'samgov',
    "source_url" = 'https://sam.gov/opp/' || "notice_id" || '/view'
WHERE "notice_id" ~ '^[A-Za-z0-9-]{8,64}$'
  AND "source" = 'manual' AND "source_url" = '';--> statement-breakpoint

-- An eBuy or GSA email paste: the first web link in the pasted text, if any.
UPDATE "opportunity" o
SET "source" = CASE a."metadata"->>'source' WHEN 'ebuy-paste' THEN 'gsa_ebuy' ELSE 'gsa_email' END,
    "source_url" = COALESCE(left(substring(a."body" from 'https?://[^\s<>"'')\]]+'), 2000), '')
FROM "opportunity_activity" a
WHERE a."opportunity_id" = o."id"
  AND a."metadata"->>'source' IN ('ebuy-paste', 'gsa-paste')
  AND o."source" = 'manual' AND o."source_url" = '';--> statement-breakpoint

-- Created from an uploaded document.
UPDATE "opportunity" o
SET "source" = 'document'
FROM "opportunity_activity" a
WHERE a."opportunity_id" = o."id"
  AND a."title" = 'Created from a document'
  AND o."source" = 'manual' AND o."source_url" = '';
