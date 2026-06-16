# BL-9 — Collaborative editor architecture

**Status:** in progress, Slice 1 (this PR)  ·  **Last updated:** 2026-06-16

This is the design we're committing to before code. The product
requirement is word-level co-editing of proposal sections with
presence cursors, then track-changes / comments / suggestion-mode
in follow-on slices. Single source of truth for design questions —
update this doc when the design changes, don't let the code and the
doc drift.

## Goals (Slice 1)

- Word-level co-editing of `proposal_section.body_doc` (TipTap doc).
- Presence cursors with the editor's display name + a stable color.
- No data loss on disconnect / browser crash (Yjs CRDT + server-side
  persistence on every commit).
- Multi-tenant isolation — a document under one org is unreachable
  from any other org's session.
- Self-hosted, MIT-licensed transport — no vendor lock-in,
  GovCloud-portable.

## Non-goals (Slice 1)

- Track changes with per-user attribution (Slice 3+).
- Comment threads anchored to text ranges (Slice 3+).
- Suggestion-mode (changes pending owner approval) (Slice 4+).
- Version snapshots / diff between versions (Slice 5+).
- FedRAMP-authorized deploy (Slice 6+, when first CUI customer signs).

## Architecture at a glance

```
Browser (Next.js app, RichSectionEditor)
   │  ws(s)://collab.forge.app/?token=<NextAuth-JWT>&doc=<org>/section/<id>
   ▼
Hocuspocus service (services/collab/, Node 22, @hocuspocus/server v4)
   │  onAuthenticate → verify NextAuth JWT, extract orgId/userId
   │  onLoadDocument → SELECT state FROM yjs_doc WHERE org_id, doc_name
   │  onStoreDocument → UPSERT yjs_doc, increment version
   ▼
Postgres (Neon, shared with main app, separate "yjs_doc" table)
```

- **Transport:** Yjs over WebSocket via `@hocuspocus/server` (MIT).
  No proprietary protocol on the wire.
- **Auth:** NextAuth-signed JWT (already used elsewhere). The Hocuspocus
  `onAuthenticate` hook verifies signature against `AUTH_SECRET`,
  extracts `userId` + `organizationId` claims, sets them on the
  connection context. Tokens are short-lived (15 min); the client
  refreshes via a Next API route before expiry.
- **Persistence:** Postgres `yjs_doc` table holds the latest
  `Y.encodeStateAsUpdate(ydoc)` blob per `(organization_id, doc_name)`
  pair. Hocuspocus rewrites the row on debounce (default 2 s after
  last edit). Awareness state (cursors) is in-memory only.
- **Tenant scoping:** `doc_name` format is `section/<proposalSectionId>`
  for Slice 1. Slice 5+ adds `section_template/<id>`,
  `solicitation/<id>`, etc. The auth hook refuses any `doc_name` whose
  associated row's `organization_id` doesn't match the JWT.

## Why these choices

- **Hocuspocus over Liveblocks / Convex / y-sweet:** see
  `docs/architecture/collab-editor-vendor-comparison.md` (TBD — research
  summary lives in the BL-9 PR description for now). Decision: only
  self-hosted MIT keeps us on a path to FedRAMP Moderate.
- **Yjs over Operational Transform:** Yjs is the de-facto CRDT for
  TipTap; first-party `@tiptap/extension-collaboration` binding. OT
  would lock us into Convex / a custom server.
- **Postgres persistence over RocksDB:** we already run Neon. One
  database to back up; restore semantics already established. RocksDB
  adds an operational surface for ~zero benefit at our scale.

## Data model

```sql
CREATE TABLE yjs_doc (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organization(id)
                   ON DELETE CASCADE,
  -- Logical doc name. Slice 1 format: "section/<proposal_section.id>".
  -- Future: "section_template/<id>", "solicitation/<id>".
  doc_name        text NOT NULL,
  -- Y.encodeStateAsUpdate(ydoc) — full doc state, not a delta stream.
  state           bytea NOT NULL,
  -- Bumped on every persist; cheap monotonic clock for snapshots
  -- + an optimistic-concurrency cross-check if needed later.
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamp NOT NULL DEFAULT now(),
  updated_at      timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX yjs_doc_org_name_uq
  ON yjs_doc (organization_id, doc_name);
CREATE INDEX yjs_doc_org_updated_idx
  ON yjs_doc (organization_id, updated_at DESC);
```

The existing `proposal_section.body_doc` (ProseMirror JSON) stays as
the canonical persisted form for non-collab readers (PDF render,
share-link, exports). On every Hocuspocus debounce we ALSO update
`proposal_section.body_doc` from the Y.Doc projection — so anything
consuming `body_doc` keeps working without modification. Slice 2
deliverable.

## Failure modes & mitigations

| Failure | Detection | Recovery |
|---|---|---|
| Hocuspocus crashes mid-session | Health check / readiness probe | Restart; clients reconnect, last `yjs_doc.state` rehydrates the doc; in-flight edits since the last persist are lost (≤ debounce window, typically 2 s) |
| Postgres write fails | Hocuspocus logs error, retries with backoff | After N retries, broadcast `connection.error` to clients; they keep working in-memory until persistence resumes |
| JWT expires mid-session | Server sends close frame `4401` | Client fetches a fresh token from `/api/collab/token` and reconnects (Yjs sync resumes from last server state) |
| Two service instances accept the same doc | Hocuspocus extension-redis pub/sub | Slice 1 = single instance, single region. Redis fan-out lands in Slice 4 |
| Operator drops `yjs_doc` row | `proposal_section.body_doc` is still canonical | Next save round-trips body_doc → Y.Doc on demand |

## Deploy target & ops (Slice 1)

- **Fly.io commercial**, single region (`iad`), single shared-1x VM.
  ~$15/mo. Not the gov tier — that comes in Slice 6 (AWS GovCloud
  for FedRAMP Moderate).
- **TLS** at Fly's edge (Let's Encrypt automatic).
- **Secrets:** `AUTH_SECRET` (shared with main app), `DATABASE_URL`
  (Neon main DB, separate role with privileges only on `yjs_doc`).
- **Backups:** Neon PITR covers `yjs_doc` along with everything else;
  no additional backup surface.
- **Observability:** structured JSON logs to stdout, captured by Fly's
  log shipper into the main `production_error_log` pipeline via
  the existing `log.error` ingestion path (Slice 2).
- **Day-2:** patch base image weekly (CI), rotate `AUTH_SECRET` via
  envar redeploy on cadence (already done for the Next app).

## Client integration approach (Slice 2)

`RichSectionEditor` gains an optional `collab?` prop:

```ts
type CollabConfig = {
  docName: string;        // e.g. "section/<proposalSectionId>"
  tokenEndpoint: string;  // "/api/collab/token"
  userName: string;       // display name
  userColor: string;      // hex, stable per user
};
```

When `collab` is provided **and** `process.env.NEXT_PUBLIC_COLLAB_ENABLED === "1"`,
the editor:
- omits `content: doc` (Y.Doc is the source of truth)
- adds `@tiptap/extension-collaboration` (binds editor to Y.Doc)
- adds `@tiptap/extension-collaboration-cursor` (presence)
- replaces `onUpdate` with a debounced
  `onYDocChange → save body_doc projection` flow so the existing
  persistence path is preserved

When `collab` is undefined or the flag is off, RichSectionEditor
renders exactly as today — no regression for single-user usage.

## Track changes / comments / suggestion-mode (Slices 3-5)

- **Track changes:** Yjs `Y.Map` of `{ userId, ts, op }` records,
  rendered as decorations via a ProseMirror plugin. Tiptap Pro ships a
  commercial extension (~$149/mo); we'll either license that or
  hand-roll on Y.Map primitives. Decision deferred to Slice 3 design.
- **Comments:** anchor a `Y.RelativePosition` to each thread; threads
  themselves stored as ordinary Postgres rows (`comment_thread`,
  `comment`). Yjs holds only the anchor — that way comment history,
  resolve/reopen, and notifications go through the same paths as the
  rest of FORGE.
- **Suggestion-mode:** a `pendingChanges` Y.Map with proposed edits
  not yet applied; owner sees an "accept / reject" UI that promotes
  the pending change into the main Y.Doc. Slice 4.

## Compliance / FedRAMP path

- **Slice 1-5:** commercial Fly.io, no CUI customers, no compliance
  bar beyond what the main app already meets.
- **Slice 6 (when first CUI customer signs):** lift services/collab/
  to AWS GovCloud (Fly is not on the FedRAMP Marketplace). The
  container image is region-agnostic by design — no Fly-specific code.
  FedRAMP 20x Moderate submission via Coalfire / Knox / Workstreet
  (~$100-300K, ~2 months); broader 20x Moderate openings target Q3 2026.

## Open questions

- **Track-changes extension: license or build?** — Slice 3 design call.
- **Document size ceiling.** Yjs is fine for ~10 K edit operations
  per doc; ProseMirror rendering is "notoriously slow" on huge docs.
  Need a per-section soft cap. TBD.
- **Image storage.** Base64-inlined images bloat Y.Docs. We already
  host images on Vercel Blob via existing flow; need to confirm the
  TipTap image extension stays compatible with the Yjs-bound editor.
  TBD Slice 2.
- **Snapshot strategy for versions.** Could store every Nth update
  as a snapshot for time-travel, but that's TBD Slice 5.

## Slices (PR cadence)

| Slice | Scope | Status |
|---|---|---|
| 1 | This PR — service skeleton + `yjs_doc` migration + architecture doc | **in progress** |
| 2 | Wire `RichSectionEditor` to Hocuspocus behind `NEXT_PUBLIC_COLLAB_ENABLED` flag; `/api/collab/token` endpoint; body_doc projection writeback | pending |
| 3 | Track changes (commercial extension license OR Y.Map implementation — TBD) | pending |
| 4 | Comments + threads; `extension-redis` for horizontal scaling if needed | pending |
| 5 | Suggestion-mode + version snapshots + diff viewer | pending |
| 6 | AWS GovCloud lift; FedRAMP 20x Moderate submission | pending |
