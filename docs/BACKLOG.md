# FORGE backlog — Chapter 16+

Comprehensive backlog of every capability captured from the platform
spec discussions. Each item has a stable **BL-N** ID; PR numbers fill
in as items ship. **Hard rule:** every BL ships complete and
production-ready (no scaffolding, no `Coming soon` stubs).

Priority key:
  - **P0** — security / multi-tenant integrity. Always next.
  - **P1** — explicit user spec. Ship in the order listed unless flagged.
  - **P2** — strongly implied by spec but not literally stated.
  - **P3** — nice-to-have; ship after P0–P2 land.

Effort key:
  - **S** — half-day or less
  - **M** — 1–3 days
  - **L** — 1–2 weeks
  - **XL** — 4–6 weeks

---

## Active priorities (2026-06-16)

| # | Item | Priority | Effort | Status |
|---|---|---|---|---|
| 1a | **BL-ENV-SEP** docs — Dev/staging/prod separation runbook | P0 | M | ✅ shipped (PR #210); operator setup pending |
| 1b | **BL-ENV-SEP** code — Runtime env-marker guard + non-prod banner | P0 | M | ✅ shipped (PR #216) — refuses to boot when env label and DB marker disagree |
| 2 | **BL-TENANT-AUDIT** — Multi-tenant data firewall comprehensive audit | P0 | L | ✅ shipped (PR #211) — PASS with documented exceptions |
| 3a | **BL-PACKAGES Slice 1** — AI token cap enforcement at gateway | P1 | M | ✅ shipped (PR #212) — gateway + 5 server-action callers |
| 3b | **BL-PACKAGES Slice 2** — Migrate 7 lib-helper AI callers | P1 | M | ✅ shipped (PR #213) — 100% tenant AI paths token-capped |
| 3c | **BL-PACKAGES Slice 3** — Super-admin usage panel: per-tenant token consumption | P1 | M | ✅ shipped (PR #214) |
| 3d | **BL-PACKAGES Slice 4** — Public pricing page | P1 | M | ✅ shipped (PR #215) — checkout pending BL-17 |
| 4 | **BL-9 Slice 2b** — SectionsClient wires collab editor | P1 | M | ✅ shipped (PR #217) |
| 5 | **BL-9 Slice 2c** — Deploy Hocuspocus to Fly + flip collab flag for pilot tenant | P1 | M | ⏳ queued (operator deploy) |
| 6 | **BL-9 Slice 2d** — Server-side body_doc projection writeback (Yjs → ProseMirror JSON on store-debounce) | P2 | S | ✅ shipped (PR #224) |
| 7 | **BL-17 Slice 1** — Payment provider research + ADR | P1 | S | ✅ shipped (PR #218) — decision: **Stripe** |
| 8 | **BL-17 Slice 2** — Stripe schema + webhook plumbing | P1 | M | ✅ shipped (PR #219) |
| 9 | **BL-17 Slice 3** — Checkout flow (`/settings/billing` → Stripe Checkout → tier provisioning) | P1 | M | ✅ shipped (PR #220) |
| 10 | **BL-17 Slice 4** — Customer portal + dunning email + tier-flip on webhook | P1 | M | ✅ shipped (PR #221) |
| 11 | **BL-17 Slice 5** — Enterprise wire-invoice flow | P1 | M | ✅ shipped (PR #222) — paused pending launch readiness |

### BL-ENV-SEP — Dev/staging/prod environment separation
**Priority:** P0  ·  **Effort:** M  ·  **Status:** 🟡 docs landed

Before the first paying customer onboards, production must be isolated from staging/dev so a developer error cannot touch real customer data. Operator runbook in `docs/ENVIRONMENTS.md`; production-deploy gate in `docs/PRODUCTION_DEPLOY_GATE.md`. Code-side guards (env validation, non-prod banners, blocked-in-staging operations) land in a follow-on PR.

### BL-TENANT-AUDIT — Multi-tenant data firewall audit
**Priority:** P0  ·  **Effort:** L  ·  **Status:** ⏳ queued

Comprehensive audit of every server action, API route, server-component DB query, and admin path for `organizationId` scoping. We have `npm run check:isolation` covering server actions today, but the audit covers cases the static checker can't see:
- API route handlers (not server actions)
- Server components fetching data without going through a tenant-gated helper
- Admin / superadmin paths that intentionally cross tenants (must be allow-listed with a documented reason)
- DB-level guarantees: every `organization_id` column has a NOT NULL constraint + an index covering tenant-scoped queries

Deliverable: `docs/audits/06-multi-tenant-firewall-2026-06.md` with findings + a remediation PR for each hole.

### BL-PACKAGES — Subscription packages + AI token caps
**Priority:** P1  ·  **Effort:** L  ·  **Status:** ⏳ queued

Super-admin-configurable subscription packages with à la carte add-ons. Schema for `subscription_tier`, `tenant_subscription`, `tenant_usage_counter` already in place from prior work; the new build:
- Super-admin UI to create/edit packages with feature flags + quotas
- Add-on system (AI, advanced reporting, etc.)
- **Per-package AI token cap** (Anthropic input + output tokens) with enforcement at the AI gateway, so a runaway tenant cannot burn through profits
- Landing page surfacing available packages
- Tenant-facing upgrade flow
- Promo codes already in schema; surface in checkout
- Stripe / Paddle integration TBD (BL-17)

Critical: token-cap enforcement happens server-side at the AI gateway, not on the client. Every AI call checks the tenant's remaining quota; over-quota → 402 Payment Required + in-app upgrade prompt.

### BL-ITAR-TAG — ITAR-restricted tenant tagging
**Priority:** P2  ·  **Effort:** S  ·  **Status:** ⏳ queued

Add `organization.itar_restricted` boolean. When true:
- All members must be US persons (admin-attested at member-add time)
- Audit log surfaces ITAR-flagged events distinctly
- Future: GovCloud-only enforcement when we lift the gov tier

Defer until first ITAR-bearing proposal lands.

## Already shipped (reference only)

| Item | Status |
|---|---|
| Multi-tenancy hardening (PR-1) | Merged #86 |
| Open redirect fix (PR-2) | Merged #87 |
| Data integrity hot fixes (PR-3) | Merged #88 |
| Hot-path indexes (PR-4) | Merged #89 |
| Markdown sanitization + samgov auth (PR-6) | Merged #90 |
| JSONB defaults + write guard (PR-9) | Merged #91 |
| Rate limiting (PR-5) | Merged #92 |
| Stub-mode UX + boot env validation (PR-10) | Merged #93 |
| Action return shapes + zod (PR-7) | Merged #94 |
| Structured logging facade (PR-8) | Merged #95 |
| Proposals In-flight / Submitted tabs | Merged #97 |
| Help → FAQ page | Merged #98 |
| Nav rebuild — 6-item structure | Merged #99 |
| Proposal launcher (queue ingest + manual chain) | Open #100 |

---

## Cleanup / debt

### BL-1 + BL-2 — Hide unbuilt nav items + delete placeholder pages — **shipped**
**Priority:** P0  ·  **Effort:** S  ·  **Status:** ✅ Combined and delivered

PR #99 shipped 5 stub pages. Per the no-placeholder rule, those nav
items + stub pages were removed atomically.

**Delivered:**
- 5 stub pages deleted: `/audit-log`, `/platform/{configuration,
  subscriptions,tenants,audit-log}`
- `ComingSoonStub` component deleted
- Operations Management → Audit Log nav item removed (re-added with
  BL-12)
- Platform Administration converted from parent-with-stub-children to
  a leaf link pointing to the existing `/admin` page; will become a
  parent group again when BL-15 / BL-16 / BL-17 / BL-18 ship

**Re-introduction plan:** each subsequent BL that adds a new top-
level menu item updates `NavContent.tsx` in the same PR.

---

## Capture & pursuit (Opportunities)

### BL-3 — Stage spell-out widgets on Opportunities Dashboard — **shipped**
**Priority:** P1  ·  **Effort:** S  ·  **Depends on:** —  ·  **Status:** ✅ shipped

Convert the S1…S7 / W / L / NB chips on `/opportunities` into proper
widgets with stages spelled out, counts, **value totals**, and due-
date proximity hints.

**Shipped earlier (foundation):**
- ✅ `StageWidget` tile component, `buildStageStats` aggregator, 10-
  widget grid with click-to-filter, "Stage N" spell-out, past-due
  badge, due-proximity hint

**Shipped now (closing the value-totals gap):**
- ✅ `src/lib/money.ts` — `parseDollars`, `formatDollars`, and a new
  `formatDollarRange(low, high)` that collapses to a single number
  when one side is zero or both ends are equal
- ✅ Pipeline funnel's `parseDollars`/`formatDollars` moved into
  `src/lib/money.ts` and re-exported from `funnel-stats.ts` for
  backwards compat — single source of truth for BL-3 + BL-4
- ✅ `StageStat` extended with `totalValueLow` + `totalValueHigh`
  fields; `buildStageStats` now sums these per stage using the
  shared `parseDollars`
- ✅ `StageWidget` renders the formatted value range as a prominent
  line in the tile (titled "Sum of opportunity value low–high
  across this stage")
- ✅ `OpportunitiesClient` plumbs the totals through

**Acceptance:** ✅ Dashboard renders 10 widgets; clicking one filters
the list below; counts match `select count(*) from opportunities
group by stage`; each tile shows its value range alongside count +
due hints.

---

### BL-4 — Pipeline funnel diagram — **shipped**
**Priority:** P1  ·  **Effort:** M  ·  **Status:** ✅ Delivered

Per spec: `/pipeline` shows a sales-funnel visualization. Was a list,
now a real funnel.

**Delivered:**
- Trapezoid-style horizontal-bar funnel — width tapers based on the
  metric, peak normalized to 100%
- Click any segment → drills into `/opportunities?stage=<key>` with
  the dashboard pre-filtered (BL-7 deep-link support)
- Conversion-rate annotation between segments (snapshot ratio of
  next stage to current; tooltip explains it's not yet historical
  conversion since stage history isn't tracked)
- Time-window pills: 30d / 90d / 365d / All time, defaults to 90d.
  State on the URL via `?days=…` for shareability + reload safety
- Mode toggle: Count / Weighted value (PWin% × midpoint(low,high))
  on the URL via `?mode=count|value`
- Outcome split (Won / Lost / No-bid) renders below the active funnel
  with the same metric, plus a win-rate annotation in the eyebrow
- Empty state when window has no opportunities — suggests widening
  the window or seeding pursuits

**Files:**
- `src/app/(app)/pipeline/page.tsx` (rewritten)
- `src/app/(app)/pipeline/funnel-stats.ts` (new — `buildFunnelData`,
  `parseDollars`, `formatDollars`)
- `src/app/(app)/pipeline/PipelineFunnel.tsx` (new — server component)
- `src/app/(app)/pipeline/PipelineFilters.tsx` (new — client component
  for the toggles, updates URL params via `router.push`)

---

### BL-5 — GSA email paste (Solicitations) — **shipped**
**Priority:** P1  ·  **Effort:** M  ·  **Status:** ✅ Delivered

Mirror of the existing eBuy paste flow, broader to handle any
forwarded GSA opportunity email — eBuy RFQs, Schedule sub-CO
notifications, OASIS+/Polaris/Alliant 2 task order announcements,
sources sought, generic GSA acquisition emails.

**Delivered:**
- New AI prompt + zod schema in `ai-prompts.ts`
  (`buildGsaExtractPrompt`, `gsaExtractionSchema`,
  `GsaExtractionResult`) covering 6 notice types: rfp / rfq / rfi /
  sources_sought / task_order / other
- New extractor lib `src/lib/gsa-extract.ts` mirroring `aiExtractEbuy`
  with stub-mode handling + zod parse
- New route `/opportunities/import/gsa` with paste UI, parsed-fields
  review, and **multi-file attachment upload** (up to 5 files,
  25 MB each — PDF / DOCX / XLSX / PPTX / TXT / image)
- Each accepted attachment becomes a Solicitation row linked to the
  new opportunity, parsed in the background by the existing
  solicitation pipeline
- "Paste GSA email" link added to the import page header next to the
  existing "Paste from eBuy"
- Stub-mode banner via the unified component when AI is in stub mode
- Per-file size + format validation; oversize/wrong-format files
  surface an "attachmentsSkipped" report on the destination page

**Files:**
- `src/lib/ai-prompts.ts` — new GSA prompt + schema
- `src/lib/gsa-extract.ts` (new)
- `src/app/(app)/opportunities/import/gsa/page.tsx` (new)
- `src/app/(app)/opportunities/import/gsa/GsaPasteClient.tsx` (new)
- `src/app/(app)/opportunities/import/gsa/actions.ts` (new)
- `src/app/(app)/opportunities/import/page.tsx` — added "Paste GSA email" header link

---

### BL-6 — "Add Source" extensibility — **shipped**
**Priority:** P1  ·  **Effort:** M  ·  **Status:** ✅ Delivered

Customers suggest additional opportunity-import sources; super-admin
triages and reports back with status. Closes the "we will also
include an Add Source option" ask in the original spec.

**Delivered:**
- Migration `0032_opportunity_source_request.sql` — new table with
  status enum (pending / under_review / shipped / rejected) and two
  indexes (org-scoped + status-scoped)
- Tenant UI: collapsible "Don't see your source?" panel on
  `/opportunities/import` with form (source name, description,
  optional sample paste) + list of own previous requests with status
  + platform-team replies
- Super-admin UI: `/admin/source-requests` triage queue with status
  filter, search, expandable rows for full description + sample +
  inline status/notes edit
- Server actions: `createSourceRequestAction`,
  `listOwnSourceRequestsAction`, `listAllSourceRequestsAction`,
  `updateSourceRequestAction` (super-admin only)
- Rate limit: 10 submissions per org per 24 hours so a single tenant
  can't flood the queue
- "Source requests →" header link added to `/admin` for discovery

**Files:**
- `drizzle/0032_opportunity_source_request.sql`
- `src/db/schema.ts` — new `opportunitySourceRequests` + enum
- `src/app/(app)/opportunities/import/source-requests/actions.ts`
- `src/app/(app)/opportunities/import/source-requests/SourceRequestPanel.tsx`
- `src/app/(app)/opportunities/import/page.tsx` — embed panel
- `src/app/(app)/admin/source-requests/page.tsx`
- `src/app/(app)/admin/source-requests/SourceRequestTriageClient.tsx`
- `src/app/(app)/admin/AdminClient.tsx` — header link to triage

---

### BL-7 — Cross-page data sync (Command Center ↔ Opportunities Dashboard) — **shipped**
**Priority:** P1  ·  **Effort:** M  ·  **Depends on:** BL-3  ·  **Status:** ✅ shipped

Both pages already shared `getOrganizationSnapshot()` and the
Command Center had the stage-grid mirror via `CommandCenterStageGrid`
shipped in earlier work. This PR closes the audit gaps the spec
called for.

**Already in place (foundation):**
- ✅ Shared `getOrganizationSnapshot()` aggregate model
- ✅ `CommandCenterStageGrid` read-only tile grid on `/`
- ✅ Most opportunity mutations already revalidate `/`

**Shipped now (audit + close):**
- ✅ Audit found 7 mutation surfaces that change Command Center
  counts but didn't `revalidatePath("/")`:
  - `opportunities/[id]/evaluation-actions.ts:setStageWithLogAction`
    — stage change
  - `opportunities/import/actions.ts:importSamGovOpportunitiesAction`
    — bulk insert
  - `opportunities/import/ebuy/actions.ts:createOpportunityFromEbuyAction`
    — single insert
  - `proposals/[id]/outcome/actions.ts:saveOutcomeAction` —
    proposal won/lost transition (affects active-proposals count)
  - `proposals/[id]/reviews/actions.ts:startReviewAction` —
    creates `in_progress` review (affects "in review" count)
  - `proposals/[id]/reviews/actions.ts:closeReviewAction` — ends
    review
  - `proposals/[id]/reviews/actions.ts:cancelReviewAction` — ends
    review
  All seven now call `revalidatePath("/")` after the mutation.
- ✅ Value-range line added to Command Center stage tiles, mirroring
  the BL-3 widgets on `/opportunities` (so the two views are now
  fully visually + numerically aligned)
- ✅ `CommandCenterStageGrid`'s inline `StageStat` fallback updated
  to include the new `totalValueLow` / `totalValueHigh` fields

**Acceptance:** ✅ Creating / advancing / closing any of the
above surfaces refreshes the Command Center on next nav with no
manual refresh; counts match `/opportunities` exactly.

---

## Proposal operations

### BL-8 — In-flight / New Proposals submenu finalization — **shipped**
**Priority:** P1  ·  **Effort:** S  ·  **Depends on:** PR #100  ·  **Status:** ✅ shipped

**Shipped:**
- ✅ Nav under Opportunities: single "Proposals" child replaced with
  two siblings — **In-flight Proposals** → `/proposals` and
  **New Proposals** → `/proposals/new`
- ✅ Tab on `/proposals` renamed "Submitted" → **Past proposals**
  (also reflects in the panel header when viewing the unfiltered
  tab). Underlying tab state key `submitted` preserved for back-
  compat. The "Submitted" meta-tile on the page header stays — that
  one refers specifically to the `submitted` stage count, distinct
  from the broader "Past proposals" tab which also includes awarded
  / lost / no_bid / archived.

**Acceptance:** ✅ Menu shows the two sub-items; clicking "In-flight
Proposals" lands on `/proposals` (default tab), clicking "New
Proposals" lands on the launcher; tab label reads "Past proposals".

---

### BL-9 — Word-level collaborative editor with track changes
**Priority:** P1  ·  **Effort:** XL (4-6 weeks)  ·  **Depends on:** —  ·  **Status:** 🟡 Slices 1, 2a, 2b, 2d shipped; 2c operator-pending; Slice 3 next

Per spec: full Word-comparable editor; multi-user real-time collab;
track changes; merge on document-owner consensus; uses company
templates. Section editing happens inside FORGE so the Brain learns
from edits.

**Architecture decision (2026-06-15):** Self-hosted **Hocuspocus + Yjs**
on commercial Fly.io for Slices 1-5; AWS GovCloud lift + FedRAMP 20x
Moderate submission in Slice 6 when first CUI customer signs. MIT
license, no vendor lock-in, first-party TipTap binding. See
`docs/architecture/collab-editor.md` for the full design + the vendor
comparison that led here (Liveblocks / Convex / y-sweet / Supabase /
PartyKit / Ably all disqualified for FedRAMP path or maturity).

**Sliced delivery:**

- **Slice 1** — Service skeleton + `yjs_doc` migration + architecture
  doc. No client wiring yet. ✅ *shipped (PR #207)*
- **Slice 2a** — Collab token endpoint (`/api/collab/token`),
  `mintCollabToken` helper, `RichSectionEditor` plumbed for optional
  Yjs binding behind `NEXT_PUBLIC_COLLAB_ENABLED` flag; tiptap
  upgrade to 3.26.1. ✅ *shipped (PR #208)*
- **Slice 2b** — `SectionsClient` passes `collab` prop; collab config
  builder; presence cursor colors. ✅ *shipped (PR #217)*
- **Slice 2c** — Deploy `services/collab/` to Fly.io; flip
  `NEXT_PUBLIC_COLLAB_ENABLED=1` for a pilot tenant; smoke test.
  ⏳ *operator deploy — engineering complete*
- **Slice 2d** — Server-side `body_doc` projection writeback: Hocuspocus
  `onStoreDocument` converts Y.XmlFragment → ProseMirror JSON + plain
  text + word count → `proposal_section`. Also updated server.ts to
  correct Hocuspocus v4 API (`new Server(...)`, `lastContext`, typed
  hook payloads). ✅ *shipped (PR #224)*
- **Slice 3** — Track changes (Tiptap Pro extension license vs.
  Y.Map-based implementation — decision in this slice).
- **Slice 4** — Comment threads anchored via `Y.RelativePosition`;
  `extension-redis` for horizontal scale if needed.
- **Slice 5** — Suggestion mode + version snapshots + diff viewer.
- **Slice 6** — AWS GovCloud lift; FedRAMP 20x Moderate submission.
- **Slice 7** — Brain feedback loop: every accepted/rejected change
  feeds the pattern-intel pipeline.

**Acceptance per slice:** measured against the existing TipTap editor
+ team workflow; specifics defined per slice when each starts.

---

## Platform intelligence (Brain & Knowledge)

### BL-10 — Knowledge ingestion improvements
**Priority:** P2  ·  **Effort:** M (phased)  ·  **Depends on:** —

Per spec: "Knowledge — critical area where a company can dump all its
historical data... The data provided here will be leveraged by the
FORGE Brain..."

Today's `/knowledge-base` supports artifact upload + manual entries.

**Already shipped (legacy, before BL-10 was formalized):**
- ✅ Bulk upload — `CorpusUploader` does multi-file drag-drop with a
  queue + per-file status pills + sequential processing.

**Phase A — AI-based artifact kind classification on upload** ✅ shipped:
- New `src/lib/knowledge-classify.ts` — `classifyArtifactKind({
  fileName, contentType, rawText })` returns `{ kind, confidence,
  reasoning, stubbed }`. Calls the AI gateway with a focused
  classification prompt that maps to the 15-value
  `knowledge_artifact_kind` enum.
- New prompt + zod schema in `ai-prompts.ts`:
  `buildArtifactKindClassifyPrompt`, `artifactKindClassifySchema`.
  System prompt enumerates kind definitions, heuristics, and
  confidence semantics. Caps the user text at 8,000 chars
  (classification needs less context than extraction).
- Wired into `extractAndIndex` in the upload pipeline: when the
  user picks "Auto-detect", after text extraction succeeds, calls
  the classifier and updates the artifact's `kind` column **only**
  when (a) AI is non-stub, (b) confidence ≥ 0.6
  (`CLASSIFY_CONFIDENCE_THRESHOLD`).
- Stub-mode safe: stubbed responses are skipped, preserving the
  existing `defaultKindFromFormat` heuristic behavior.
- Best-effort: any failure logs and leaves the heuristic kind in
  place. Doesn't block extraction completion.
- Auto-detect is the default in `CorpusUploader`, so the
  classification kicks in for nearly every uploaded file unless the
  user deliberately picks a specific kind.

**Phase B-1 — Surface suggestions on artifact rows** ✅ shipped:
- Migration `0047_knowledge_artifact_ai_classification.sql` adds
  three columns to `knowledge_artifact`:
  - `ai_suggested_kind` — `knowledge_artifact_kind` enum, nullable
  - `ai_classification_confidence` — real (0..1), nullable
  - `ai_classification_reasoning` — text, default ""
- Drizzle schema updated with matching fields + `real` import.
- The Phase A classifier integration now ALSO persists its output
  to these columns regardless of whether the suggestion was
  applied. Confidence >= 0.6 still overwrites `kind`; lower
  confidence leaves `kind` alone but the suggestion is recorded
  so the UI can surface it.
- `ListedArtifact` shape extended with the three new fields; the
  list query selects them.
- `ArtifactRow` shows an "AI suggests: <kind> · N% confidence"
  pill (violet accent) when `ai_suggested_kind` differs from the
  applied `kind`. Pill has an **Accept** button that fires the
  new `acceptKindSuggestionAction(artifactId)` server action.
  Tooltip on Accept shows the AI's reasoning.
- `acceptKindSuggestionAction` is org-scoped (callers can only
  accept on their own org's artifacts), refuses when no suggestion
  exists or already matches kind. Revalidates the import page.

**Phase B-2 — Classifier backfill** ✅ shipped:
- New server actions in `knowledge-base/import/actions.ts`:
  - `countClassifyBackfillCandidatesAction()` — counts artifacts in
    the caller's org with `kind='other'` + no AI suggestion + raw
    text present.
  - `runKnowledgeClassificationBackfillAction()` — org-admin gated.
    Selects up to 50 candidates, runs the classifier on each,
    persists the suggestion + reasoning + confidence. High-
    confidence results (>= 0.6) overwrite `kind` immediately;
    lower-confidence ones surface as Phase B-1 pills for admin
    review. Idempotent — won't re-process already-suggested rows.
    Per-row try/catch so one failure doesn't block the rest.
- New client component `ClassifyBackfillButton` rendered on
  `/knowledge-base/import` when the candidate count is > 0.
  Shows count + "Reclassify" button. Displays per-run summary
  (processed / auto-applied / low-confidence / skipped) after
  completion.
- 50-per-click cap keeps a single call from running away on huge
  corpora; admin re-clicks to drain the rest.

**Phase C-1 — Group corpus by kind** ✅ shipped:
- New `CorpusList` client component wraps the import-page artifact
  list with a "Group by: Flat / By kind" toggle. Flat preserves the
  original newest-first list; "By kind" buckets artifacts under
  collapsible kind headers, sorted by bucket size (largest first).
  Client-side only — re-buckets the already-loaded list, no extra
  queries.
- Empty-state copy moved into the component; `page.tsx` now renders
  `<CorpusList artifacts={...} />` instead of the inline `<ul>`.

**Phase C-2 (queued) — Full tree + tag grouping + drag-drop**:
- Nest the grouping (kind > tags > date) and add drag-drop to re-tag.
- Requires a re-tag server action + a tag-management surface; the
  Phase C-1 grouping is the foundation.

**Phase D-1 — Quality score schema + scorer helper** ✅ shipped:
- Migration `0048_knowledge_entry_quality_score.sql` adds three
  columns to `knowledge_entry`:
  - `quality_score` real (nullable, 0..1)
  - `quality_score_factors` jsonb (default `{}`) — per-signal
    contributions for the editor UI
  - `quality_scored_at` timestamp (nullable) — lets us re-score
    stale entries after the scorer itself changes
- New helper `src/lib/knowledge-quality.ts` — pure heuristic
  scorer (no AI call). Six weighted signals adding to 1.0:
  bodyLength (0.30), bodyStructure (0.15), title (0.10), tags
  (0.10), metadata (0.10), kindSpecific (0.25). Returns
  `{ score, factors }` where factors carries each signal's
  contribution for the editor breakdown.
- Kind-specific bonuses:
  - `past_performance`: year, award value, customer/agency
  - `capability`: deliverables/methods, outcomes/results, bullets
  - `personnel`: years experience, certifications, named role
  - `boilerplate`: neutral (judged by length + structure alone)
- Standalone — no integration with existing create/update flows yet;
  the columns exist for Phase D-2 to populate them.

**Phase D-2 — Wire scorer + surface in editor** ✅ shipped:
- `createKnowledgeEntryAction` scores on insert and persists
  `qualityScore` + `qualityScoreFactors` + `qualityScoredAt`.
- `updateKnowledgeEntryAction` loads the current row, merges the
  partial input, re-scores against the merged shape, and includes
  the new score columns in the existing UPDATE (no second round-
  trip). Tag-only edits now re-score too.
- New `backfillKnowledgeEntryQualityScoresAction` — org-admin
  gated, processes up to 100 unscored entries per click, returns
  `{ processed, remaining }` for the UI summary. Per-row try/catch
  isolates failures.
- Entry editor (`EditEntryClient`) shows a violet-bordered Quality
  score panel: tone-coded percentage (emerald ≥ 70%, amber 40–69%,
  rose < 40%) + per-factor breakdown table + hint text. Falls back
  to a muted "will compute on next save" line when the score is
  still NULL.
- New `RescoreEntriesButton` next to the existing "Embed missing"
  button in the knowledge-base header. Same idempotent pattern.

**Acceptance (full ticket):** drop 20 files at once → all index
successfully → auto-categorized with reviewable suggestions → quality
scores show.

---

### BL-11 — Brain self-improvement loop
**Priority:** P2  ·  **Effort:** L  ·  **Depends on:** BL-9f

Per spec: "[Knowledge] will also learn from proposals being written
within the platform and grow its ability to deliver excellence with
every proposal, compete with itself, and challenge itself..."

The Brain currently uses pattern intel from sections marked complete.
Self-improvement extends this:

**Scope:**
- Per-section A/B comparison: Brain generates a draft; user edits;
  diff feeds learning signals
- Quality benchmark suite: known inputs → expected outputs; track
  metric drift over time
- "Compete with itself" — generate two drafts using different prompt
  strategies, score them, surface the better one
- Surfaces rejected / accepted suggestion stats per writer per
  section kind

**Acceptance:** quality metric trends visibly upward over a
multi-proposal window; A/B comparisons capture and persist.

---

## Operations Management (per-tenant admin)

### BL-12 — Tenant-scoped Audit Log — **shipped (foundation + critical path coverage)**
**Priority:** P0  ·  **Effort:** L  ·  **Status:** ✅ Foundation + ~30 critical mutations audited. Long-tail sweep tracked as **BL-12b**.

Per spec: "tenant-specific audit logs for customer admins to see who
accesses, when, and what they did."

**Scope:**
- New schema: `audit_log` (id, organization_id, actor_user_id,
  actor_session_id, action, resource_type, resource_id, metadata
  jsonb, ip, user_agent, created_at) with index on (org_id,
  created_at desc) + index on (org_id, resource_type, resource_id)
- `recordAudit()` helper; called from EVERY mutating server action
  (companies, opportunities, proposals, sections, compliance, knowledge,
  templates, users, settings, notifications)
- `recordRead()` for sensitive reads (export, download, share-link
  generation, search results that surface PII)
- Query API: filter by actor, action, resource, time window
- UI on `/audit-log` (replaces the stub): filterable table, CSV
  export, drill-into-resource link
- Retention policy: 365 days default, configurable per tenant

**Acceptance:** every action (create / update / delete / share /
export) generates a row; UI filters work; CSV export downloads
correctly with proper escaping.

**Delivered in BL-12 PR:**
- `drizzle/0034_audit_log.sql` — table with 3 indexes (org+created
  desc, org+resource, org+actor)
- `src/db/schema.ts` — `auditLogs` table + types
- `src/lib/audit-log.ts` — `recordAudit()` helper that grabs IP
  + user-agent from request headers, fail-open on DB errors
- `src/app/(app)/audit-log/{page,actions,AuditLogClient}.tsx` —
  filterable table, CSV export, drill-into-detail rows showing full
  metadata + user-agent + IP
- Nav: re-added Audit Log under Operations Management
- ~30 critical mutations audited across 13 action files:
  opportunities (CRUD + stage), proposals (CRUD + stage), companies
  (CRUD + samgov refresh), users (invite/revoke/role/status/remove),
  settings (profile + samgov sync), templates (create/update),
  solicitations (upload), solicitation reviews (BL-23 review/
  matrix/questions), opportunity imports (eBuy + GSA + source-
  request CRUD), admin (org create/disable)

---

### BL-12b — Tenant Audit Log: long-tail mutation coverage — **shipped**
**Priority:** P1  ·  **Effort:** M  ·  **Depends on:** BL-12  ·  **Status:** ✅ Mutating action sweep complete (PR-A #135 merged, PR-B #136 merged). Sensitive-read coverage + retention split out to **BL-12c**.

**PR-A (#135):** 33 audit calls across the proposals / opportunities /
solicitations cluster:
- ✅ `proposals/[id]/compliance/actions.ts` (7)
- ✅ `proposals/[id]/outcome/actions.ts` (2)
- ✅ `proposals/[id]/outcome/winner-actions.ts` (1)
- ✅ `proposals/[id]/reviews/actions.ts` (9)
- ✅ `proposals/[id]/harvest-actions.ts` (1)
- ✅ `proposals/[id]/sections/ai/auto-draft-actions.ts` (1)
- ✅ `solicitations/[id]/team-actions.ts` (2)
- ✅ `opportunities/[id]/review/actions.ts` (3 — includes token-scoped public submission with reviewer-snapshot actor)
- ✅ `opportunities/[id]/evaluation-actions.ts` (7)

**PR-B (#136):** 28 audit calls (delta) across knowledge-base /
notifications / templates / admin:
- ✅ `knowledge-base/actions.ts` (6, pre-existing)
- ✅ `knowledge-base/import/actions.ts` (4)
- ✅ `knowledge-base/import/[id]/actions.ts` (5)
- ✅ `notifications/actions.ts` (2, pre-existing)
- ✅ `settings/templates/actions.ts` (8)
- ✅ `admin/actions.ts` (7 — `resolveAuditOrgForUser` helper for super-admin platform ops without a native tenant context)

**Acceptance (this ticket):** every mutating server action across
`src/app/(app)` that touches a tenant-scoped table records an audit
row. ✅ Met.

---

### BL-12c — Sensitive-read auditing + retention configuration — **shipped**
**Priority:** P1  ·  **Effort:** S–M  ·  **Depends on:** BL-12b  ·  **Status:** ✅ Merged #137

Split out from BL-12b because it needed new infrastructure (retention
column + cron pruner + admin UI) rather than additive logging.

**`recordRead()` wired (PR #137):**
- ✅ `proposals/[id]/pdf/actions.ts` — three render actions
  (`renderProposalPdfAction`, `renderProposalDocxAction`,
  `renderProposalDocxAsPdfAction`) → `proposal.export.render`
- ✅ `api/proposals/[id]/pdf/[renderId]/route.ts` → `proposal.export.download`
- ✅ `opportunities/[id]/review/actions.ts:getReviewRequestByTokenAction`
  → `opportunity.review.link_loaded` (token-scoped; reviewer-snapshot
  actor)
- ✅ `knowledge-base/usaspending/actions.ts:searchUsaspendingAction`
  → `knowledge.usaspending.search`

**Mutation gap closed (PR #137):**
- ✅ `importUsaspendingAwardsAction` → `knowledge_artifact.usaspending_import`
  (file was missing from BL-12b's original list)

**Retention configuration (PR #137):**
- ✅ Migration `0038_audit_retention.sql` —
  `organization.audit_retention_days` integer default 365
- ✅ `setAuditRetentionDaysAction` org-admin-only, 90–3650 day bound,
  self-audits as `settings.audit_retention.update`
- ✅ `AuditRetentionPanel` mounted under `/settings` (admin-only,
  uses existing `aur-*` design tokens)
- ✅ `pruneAuditLogsAcrossTenants` helper in `audit-log.ts` — per-
  tenant DELETE with explicit `organization_id` filter (passes
  static isolation check)
- ✅ `/api/cron/prune-audit-logs/route.ts` — Bearer-CRON_SECRET
  auth, returns `{ ok, organizations, rowsDeleted }`
- ✅ `vercel.json` daily at 03:30 UTC

**Fixup commit:** Next.js forbids non-async exports from `"use server"`
modules. Constants moved into sibling `audit-retention-constants.ts`.

**Acceptance:** ✅ All met. The BL-12 family is now fully complete
(BL-12 / BL-12b / BL-12c).

---

### BL-13 — Notifications rules engine
**Priority:** P0  ·  **Effort:** L  ·  **Depends on:** —  ·  **Status:** Phase A + B + C + D shipped; Phase E queued

Per spec: "notifications can be configured, who receives them, their
frequency, and whether there is an SLA for escalations. These should
all be configurable."

**Phased delivery** (strict-serial: one phase per PR):

**Phase A — Schema + types + empty admin UI (this ticket)**:
- ✅ Migration `0039_notification_rules.sql` adds two tables +
  four enums:
  - `notification_rule` — id, org_id, name, description, trigger_event_kind,
    match_filter jsonb, recipient_strategy, recipient_config jsonb,
    channels[], frequency, sla_seconds, escalation_strategy jsonb,
    active, created_by_user_id, created_at, updated_at
  - `notification_delivery` — id, org_id (denormalized for tenant
    isolation), rule_id, trigger_event_kind, trigger_payload jsonb,
    recipient_user_id, channel, sent_at, acked_at, sla_breached_at,
    escalated_at, error, created_at
  - Enums: `notification_trigger_event_kind` (14 values),
    `notification_recipient_strategy` (3),
    `notification_channel` (4),
    `notification_frequency` (3)
  - Indexes: org+active, org+event for rules; org+rule+created and
    recipient+created for deliveries; partial index for the cron's
    "find unacked past SLA" query
- ✅ Drizzle schema updated to match — types exported
  (`NotificationRule`, `NotificationDelivery`, plus each enum's
  literal-union type)
- ✅ `src/lib/notification-rules-types.ts` — UI labels for each
  enum + `FORMULA_KINDS` constant + `FormulaKind` type
- ✅ `/notifications/rules` page — server-rendered list view with
  empty-state copy explaining what a rule is + a stub `+ New rule`
  link (the new/edit pages land in Phase B)
- ✅ Nav: `Notification rules` added under Operations Management,
  admin-only

**Phase B — Rule CRUD + editor UI** ✅ shipped:
- ✅ `src/lib/notification-rules-validation.ts` — zod schemas with
  discriminated union for `recipient` (specific_users / role_based /
  formula), nullable escalation, SLA seconds bounded 0–30 days
- ✅ `src/app/(app)/notifications/rules/actions.ts` — five server
  actions: `createNotificationRuleAction`,
  `updateNotificationRuleAction`,
  `setNotificationRuleActiveAction` (activate / deactivate),
  `deleteNotificationRuleAction`, `getNotificationRuleAction` (read
  for the edit page), `listOrgUsersForRecipientPickerAction` (read
  for the user picker). Each mutation calls `requireOrgAdmin` and
  records audit (`notification_rule.create` / `.update` /
  `.activate` / `.deactivate` / `.delete`).
- ✅ `src/app/(app)/notifications/rules/RuleEditorForm.tsx` —
  shared client component used by both `new/` and `[id]/` routes.
  Renders identity / trigger / recipients / delivery / escalation /
  status panels with strategy-aware sub-forms (multi-user picker,
  role checklist, formula dropdown). SLA exposed in hours, stored
  as seconds.
- ✅ `src/app/(app)/notifications/rules/new/page.tsx` — admin-gated
  server component mounting the editor in create mode
- ✅ `src/app/(app)/notifications/rules/[id]/page.tsx` — admin-gated
  server component loading the rule + mounting the editor in edit
  mode with deactivate / delete affordances
- Channels: in-app + email selectable; Slack / Teams disabled with
  "(coming soon)" badge — Phase C/D will land them
- Match filter: JSON textarea, server validates it parses to an object

**Phase C — Trigger dispatcher** ✅ shipped:
- ✅ `src/lib/notification-dispatcher.ts` — `dispatchTriggerEvent({
  kind, organizationId, payload, subject, body?, linkPath?,
  proposalId?, reviewId?, commentId?, actorUserId? })` entry point.
  Reads matching active rules for the tenant + kind, applies
  `matchFilter` as a subset-equality predicate, dispatches per
  (recipient × channel). Best-effort: every error caught + logged,
  user-facing flow never blocked. Frequency semantics:
  `immediate` → `sent_at = now()`, `batched_*` → `sent_at = null`
  (Phase D cron materializes).
- ✅ `src/lib/notification-recipient-resolver.ts` —
  `resolveRecipients({ organizationId, strategy, config, payload })`
  → `userId[]`. Three branches:
    - `specific_users`: filtered against current active members
    - `role_based`: query memberships joined by role
    - `formula`: dispatch on `kind` for `proposal_owner` /
      `opportunity_owner` / `capture_mgr` / `pricing_lead` /
      `section_author`. Each branch reads one tenant-scoped row.
  Empty / malformed configs degrade to empty list with a warning
  log rather than throwing.
- ✅ Channel handling:
    - `in_app`: creates `notification_delivery` row + appends to
      legacy `notification` table for the inbox to render
    - `email`: creates delivery row; sending logic lands in Phase D
      with the email integration
    - `slack` / `teams`: delivery row created with `error="channel
      not yet implemented"` so the audit trail captures the gap
- ✅ Wired into four representative call sites (Phase E migrates
  the rest):
    - `opportunities/actions.ts:setOpportunityStageAction` →
      `opportunity_advanced` / `_won` / `_lost` / `_no_bid` by stage
    - `proposals/actions.ts:createProposalAction` → `proposal_created`
    - `proposals/[id]/reviews/actions.ts:startReviewAction` →
      `review_request_pending`
    - `proposals/[id]/reviews/actions.ts:closeReviewAction` →
      `review_completed` (fires in parallel with the legacy
      hardcoded notification dispatch; legacy retired in Phase E
      once seeded default rules cover the surface)
- ✅ Tenant isolation: every dispatcher / resolver query is
  organization-scoped via `eq(table.organizationId, organizationId)`.
  `src/lib/` location means the queries are outside the static
  isolation check's window, but they still respect the contract.

**Phase D — Cron + SLA escalation** ✅ shipped:
- ✅ `src/lib/notification-cron.ts` — two pure helpers:
  - `materializeNotificationBatches()` collapses pending
    `batched_daily` / `batched_weekly` delivery rows into one inbox
    row per (recipient × channel × cadence). Weekly only fires on
    Sunday UTC so users get exactly one weekly digest.
  - `processSlaBreaches()` finds delivery rows past their rule's
    `sla_seconds` with `acked_at IS NULL` AND `sla_breached_at IS NULL`,
    sets `sla_breached_at = now()`, and — if the rule has an
    `escalation_strategy` — resolves fallback recipients via the
    Phase C resolver and creates escalation delivery rows.
- ✅ `src/app/api/cron/notification-batches/route.ts` — daily at
  04:00 UTC (offset from prune-audit-logs at 03:30 + cert refresh
  at 03:00 on the 1st).
- ✅ `src/app/api/cron/notification-sla/route.ts` — every 15
  minutes (`*/15 * * * *`). 15-min granularity matches typical
  hour-scale SLA windows without spinning constantly.
- ✅ Both routes use the same Bearer `${CRON_SECRET}` auth pattern
  as the existing crons.
- ✅ `vercel.json` updated with the two new cron entries.

Per-tenant isolation: every query inside both crons references
`organizationId` from each delivery row; no cross-tenant joins.

**Phase E-1 — Test send** ✅ shipped:
- ✅ `testSendNotificationRuleAction(ruleId)` server action —
  admin-only, requires the rule to be active, calls
  `dispatchTriggerEvent` with a `testSend: true`-tagged payload so
  downstream filters/debug can distinguish test vs real
- ✅ "Test send" button in the rule editor (edit mode only),
  disabled when the rule is inactive with a tooltip explaining why
- ✅ Separate `notice` state in the editor for success messages
  (emerald-styled banner), distinct from the error state
- ✅ Audit: `notification_rule.test_send` logged on every fire
- **Limitation (accepted):** test payload is empty, so rules whose
  `match_filter` requires specific keys won't match against a test
  send. Admins exercise filter logic by triggering real events.

**Phase E-2a — Extend trigger-event-kind enum for remaining hardcoded sites** ✅ shipped:
Audit (see commit message) found three hardcoded notification sites
still bypassing the rules engine, and the enum was missing values to
represent them:
- `addReviewCommentAction` → `dispatchCommentMentionNotification` →
  needs `comment_mentioned`
- `submitOpportunityReviewAction` → direct `db.insert(notifications)` →
  needs `opportunity_reviewed`
- `assignSolicitationRoleAction` → direct `db.insert(notifications)` →
  needs `solicitation_role_assigned`

Phase E-2a is the mechanical prerequisite: migration `0040` adds the
three enum values, `schema.ts` and `notification-rules-types.ts`
expose them with UI labels so admins can build rules against them
even before E-2b wires the dispatch.

**Phase E-2b-1 — Parallel `dispatchTriggerEvent` wiring** ✅ shipped:
- `dispatchTriggerEvent` now fires alongside each of the three
  hardcoded notification sites identified in E-2a. Parallel-dispatch
  pattern matches Phase C's shadow at `closeReviewAction`. Legacy
  paths remain live (no behavior change for tenants without custom
  rules); rules-engine subscribers now ALSO receive deliveries from
  these triggers if they've configured matching rules.
- Sites wired:
  - `addReviewCommentAction` → `comment_mentioned` (one dispatch per
    `addReviewCommentAction` call regardless of mention count; payload
    carries `mentionedUserIds` so `match_filter` rules can fan out)
  - `submitOpportunityReviewAction` → `opportunity_reviewed`
  - `assignSolicitationRoleAction` → `solicitation_role_assigned`
- Subject + body re-used from the legacy notification payload to
  keep messaging consistent across both dispatch paths.

**Phase E-2b-2a — Resolver extensions** ✅ shipped:
- New recipient strategy `mentioned_in_payload`: reads
  `payload.mentionedUserIds` and filters to active members. Rule
  carries no config — runtime decides the recipient set.
- New formula kind `review_assignee`: reads `payload.reviewId` and
  returns every user in `proposal_review_assignment` for that review.
  Org-scoped via join through `proposal_reviews` → `proposals`.
- Migration `0041_*` adds `mentioned_in_payload` to the
  `notification_recipient_strategy` Postgres enum.
- `FORMULA_KINDS` extended with `review_assignee`.
- Rule editor surfaces the new strategy + formula kind; selecting
  `mentioned_in_payload` shows an inline explainer (no extra config).
- Escalation also accepts the new strategy.

**Phase E-2b-2b — Seed default rules per existing tenant** ✅ shipped:
- Migration `0042_seed_default_notification_rules.sql` inserts default
  `notification_rule` rows for every existing organization, covering
  the five hardcoded trigger semantics so the rules engine matches
  legacy behavior. `INSERT ... SELECT FROM organization WHERE NOT
  EXISTS (...)` makes the migration idempotent per the recorded
  decision: skip a kind for an org if it already has any rule for
  that kind.
- Six rules total inserted per "clean" org (two for `review_completed`).
- All defaults are named `Default: <human label>` with a description
  noting they were auto-seeded, so admins can recognize and tweak
  them in the rule editor.
- `assignSolicitationRoleAction` updated to also populate
  `payload.mentionedUserIds: [input.userId]` so the
  `mentioned_in_payload` seed rule resolves to the newly-assigned
  user (no resolver change needed).
- Default-rule semantics:
  | Kind | Recipient strategy | Channel | Frequency |
  |---|---|---|---|
  | `review_completed` | formula `review_assignee` + formula `proposal_owner` (two seed rules) | in_app+email | immediate |
  | `review_request_pending` | formula `review_assignee` | in_app+email | immediate |
  | `comment_mentioned` | `mentioned_in_payload` | in_app+email | immediate |
  | `opportunity_reviewed` | formula `opportunity_owner` | in_app | immediate |
  | `solicitation_role_assigned` | `mentioned_in_payload` | in_app | immediate |

**Phase E-2c (shipped, partial) — Retire 4 of 5 legacy dispatcher paths**:
Shipped on 2026-06-14, ≥9 days after PR #160 (initial Phase E-2b)
landed June 5. The retirement deletes:
- ✅ `dispatchReviewCompletedNotification` + parallel call in
  `closeReviewAction` — `review_completed` rule (seeded by 0042)
  with `review_assignee` + `proposal_owner` formulas covers it
- ✅ `dispatchCommentMentionNotification` + parallel call in
  `addReviewCommentAction` — `comment_mentioned` rule with
  `mentioned_in_payload` strategy covers it
- ✅ Direct `db.insert(notifications)` in `submitOpportunityReviewAction` —
  `opportunity_reviewed` rule with `opportunity_owner` formula covers it
- ✅ Direct `db.insert(notifications)` in `assignSolicitationRoleAction` —
  `solicitation_role_assigned` rule with `mentioned_in_payload`
  covers it
- ✅ Legacy `dispatchReviewAssignedNotification` call removed from
  `startReviewAction` — `review_request_pending` rule with
  `review_assignee` formula covers the initial fan-out

**Phase E-2c kept**: `dispatchReviewAssignedNotification` + its usage
via `fanOutAssignmentNotifications` in `assignReviewerAction`. See
Phase E-2d below.

**Phase E-2d (shipped) — Migrate `assignReviewerAction` to the rules engine**:

Completes the legacy notification dispatcher retirement started in
Phase E-2c. `assignReviewerAction` adds a single reviewer to an
existing review — distinct from the initial review-start fan-out.
The existing `review_request_pending` rule uses formula
`review_assignee` which would over-notify every previously-assigned
reviewer on a single-reviewer add. So Phase E-2d added a separate
trigger event kind:

- ✅ Migration 0050 adds `review_assignment_added` to the
  `notification_trigger_event_kind` enum
- ✅ Migration 0051 seeds a default rule per tenant using the
  `mentioned_in_payload` recipient strategy so only the
  newly-assigned user is notified
- ✅ `assignReviewerAction` now fires `dispatchTriggerEvent({
  kind: "review_assignment_added", payload: { ...,
  mentionedUserIds: [input.userId] } })`
- ✅ `fanOutAssignmentNotifications` helper deleted
- ✅ `dispatchReviewAssignedNotification` deleted
- ✅ `src/lib/notifications.ts` deleted entirely
- ✅ `legacyKindFor` switch in `notification-dispatcher.ts` extended
  with `review_assignment_added → review_assigned` mapping
  (inbox kind stays the same; the late-add vs initial-fan-out
  distinction lives in the trigger event kind + rule, not in the
  inbox row)

**Acceptance:** ✅ Every notification path in the codebase that
fires a notification now goes through `dispatchTriggerEvent`. Zero
direct `db.insert(notifications)` outside the dispatcher itself
(verified by `grep -r "db.insert(notifications)"` returning only
`notification-dispatcher.ts`, `notification-cron.ts`, and the
dispatcher's own inbox-parity writes).

**Acceptance (BL-13 full ticket):** create a rule "notify pricing-lead 48h
before due date"; opportunity advances within 48h; rule fires;
notification delivered; SLA breach escalates to PM if not acknowledged.

---

### BL-14 — Settings page route split ✅ SHIPPED

PR #99 deep-linked Settings tabs via `?tab=integrations`. The spec
asks them to be separate menu items; they're treated as such, but
under the hood they were all `/settings`. Refactored to real routes
so each has its own URL.

**Shipped scope:**
- `/users` absorbs UsersRolesTab content (merge path — `/users`
  already existed as the management page)
- `/settings/integrations` → standalone route
- `/settings/ai-engine` → standalone route
- `/settings` → just OrganizationTab (the "real" Settings)
- `?tab=` deep-link logic removed from SettingsClient; legacy
  `?tab=users` / `?tab=integrations` / `?tab=ai` redirect to the
  new routes for back-compat with bookmarks.
- Sidebar nav points at the new URLs directly.

**Acceptance:** each settings section has its own URL + browser
back/forward works; deep-linking via `?tab=` no longer needed.

---

## Platform Administration (super-admin only)

> Cross-cutting requirement (P0): every route under `/platform/*`
> calls `requireSuperadmin()` server-side. Multi-tenant data
> isolation is enforced by every query. Defense in depth: nav
> hides + route gates + database row-level filters.

### BL-15 — Tenant Administration
**Priority:** P0  ·  **Effort:** L (phased)  ·  **Depends on:** BL-12 (uses audit log)

Per spec: "this is where the customer accounts are managed."

**Phased delivery** (strict-serial: one phase per PR):

**Phase A — Per-tenant detail page** ✅ shipped:
- New `/admin/orgs/[id]` route, superadmin-only
- Read-only operational summary: member count, opportunity count,
  proposal count, knowledge-artifact count + total storage bytes,
  notification-rule count, audit-log row count for the last 30 days,
  top-5 most active operators (last 30d, by audit-row count)
- Identity panel with org id, slug, status, created-at + contact
  fields snapshot
- Audited via `recordRead` (`tenant.view_summary`) every page load —
  superadmins reading cross-tenant data is itself a sensitive action
- "Details →" link added to each row of the existing `/admin` org
  list to surface the new page
- Provision / suspend / restore / delete remain on the existing
  `/admin` list (already shipped as part of the SuperAdmin portal);
  Phase B adds the remaining items.

**Phase B-1 — Tenant data export for offboarding** ✅ shipped:
- New superadmin-only GET route `/api/admin/orgs/[id]/export` that
  returns a single JSON bundle of the tenant's metadata + records.
  Per the AskUserQuestion decisions captured before implementing:
  - **Format**: single JSON bundle (one file)
  - **Scope**: records + metadata, no large blobs (no proposal
    section bodies, no knowledge artifact raw_text, no audit log
    rows — those remain accessible via their existing surfaces)
  - **Delivery**: synchronous download. Adequate for tenant sizes
    we have today; async-queue alternative tracked if we hit Vercel's
    response-size or duration limits.
- Bundle includes: organization row (full identity + contact +
  registration IDs + socio-economic + naics/psc), memberships (with
  user email/name/role/status/joinedAt), opportunities (id/title/
  agency/stage/solicitation number/timestamps — no description body),
  proposals (id/title/stage/owner IDs/timestamps — no sections),
  knowledge artifacts (id/title/kind/file metadata — no raw_text),
  notification rules (full definition).
- Every export writes a `tenant.data_export` `recordRead` row into
  the target tenant's audit log so the tenant's own org-admin can
  see in `/audit-log` when their data was exported. Metadata field
  carries per-table row counts for forensics.
- Filename: `forge-tenant-<slug>-<YYYY-MM-DD>.json` with
  `Content-Type: application/json; charset=utf-8`,
  `Content-Disposition: attachment` so browsers handle the download.
- UI: "Export data ↓" button added to the per-tenant detail page
  header on `/admin/orgs/[id]`; uses plain `<a href>` so browser
  download handling kicks in (not Next client navigation).

**Phase B-2 — Transfer ownership** ✅ shipped:
- Migration `0046_organization_primary_admin.sql` adds the new
  nullable `primary_admin_user_id` FK column to `organization`
  (ON DELETE SET NULL — hard-deleting a user clears the pointer
  rather than cascading). Backfill picks the oldest active admin
  membership per org as the initial primary; orgs with no active
  admins stay NULL.
- Drizzle schema updated. `primaryAdminUserId` field added to the
  organizations table definition.
- New server action `transferOwnershipAction({ organizationId,
  newPrimaryUserId })` in `admin/orgs/[id]/actions.ts`:
  - Superadmin-gated. Refuses no-op (same user as current).
  - Verifies the target user is an **active admin of THIS org**
    (joins `membership` × `user`, checks `role='admin' AND
    status='active'`). Won't accidentally promote a non-admin or
    a disabled user.
  - Audits as `tenant.transfer_ownership` with
    `{ fromUserId, toUserId, toEmail, toName }` in metadata
    written into the **target tenant's** audit log so their own
    org admins see the change.
- New helper `listOrgAdminsAction(orgId)` returns active admins
  for the dropdown.
- New client component `TransferOwnershipForm` — dropdown of
  active admins with `(current)` marker, Transfer button (disabled
  on same-selection), browser confirm dialog, result banners.
- Per-tenant detail page (`/admin/orgs/[id]`) Identity panel now
  shows a "Primary admin" field (resolved name/email) and renders
  the transfer form below the field grid.

**Phase B-3a (shipped) — Tenant activity view + per-tenant user management**:
Highest-value subset of Phase B-3 shipped without the session-
impersonation surface area. Two operator-triage tools that together
cover the "tenant is stuck" cases the spec called out (admin left
without promoting a replacement, locked-out user, pending-invite
stuck, member needs promotion).

**Tenant activity (shipped first):**
- New route `/admin/orgs/[id]/activity` — superadmin-only, read-only
- Recent activity panel: latest 50 audit-log rows for the tenant
  with action / actor / resource / timestamp / relative time
- Health panel: unresolved error count (links to `/admin/errors`),
  last activity timestamp, notification delivery health (7d OK vs
  errored counts), disabled-state banner if applicable

**Per-tenant user management (shipped follow-up):**
- New route `/admin/orgs/[id]/users` — superadmin-only
- Members panel — every member with role / status / verified state /
  joined date / primary-admin flag / global-disabled flag
- Per-member actions:
  - **Change role** (admin / capture / proposal / author / reviewer
    / pricing / viewer) via dropdown
  - **Disable / Re-enable membership** — toggles
    `membership.status` for this tenant only; doesn't touch the
    user's global account
  - **Remove** — deletes the membership row (user keeps account)
- Pending invites panel — per-invite **Resend** + **Revoke**
- Safety: refuses to demote / disable / remove the only active
  admin (prevents tenant from being stranded)
- "⚠ No active admins" banner when activeAdminCount === 0
- Pointer panel linking to global SuperAdmin portal for cross-tenant
  ops (disable user globally, force password reset, toggle
  superadmin)
- Audit posture: every action writes to the TARGET tenant's audit
  log with `viaSuperadmin: true` in metadata so the tenant's admins
  can later see what platform support did
- "Users →" + "Activity →" links added to `/admin/orgs/[id]` actions row

Combined: an operator can land on `/admin/orgs/[id]` from the
SuperAdmin portal, click through to **Activity** to see what's
happening, click through to **Users** to fix membership/role
issues, all without leaving the admin surface.

Full assume-identity (session impersonation + confirm-with-reason +
read-only enforcement) is **Phase B-3b** — punted because the
infrastructure cost (~600-800 LOC including security review, session
plumbing, write-block enforcement) outweighs the immediate triage
need. Phase B-3a satisfies the operator's "what's going on in this
tenant" question without the security-sensitive surface.

**Phase B-3b (queued) — Full assume-identity flow**:
- Session-level impersonation cookie + middleware override of
  `requireCurrentOrg()`
- Confirm-with-reason modal before assuming identity (reason
  required, written to audit)
- Visible banner on every authenticated page while impersonating
  ("🛡 Viewing as <tenant name> — Exit")
- All mutating server actions refuse with a clear message during
  impersonation; reads work normally
- `superadmin.assume_start` / `superadmin.assume_end` audit rows

**Phase B-3c (queued) — Audit isolation status check**:
Gated on BL-19 Phase 2 test framework. A button that runs sample
cross-tenant queries to verify isolation, then writes a structured
result row.

**Acceptance (full ticket):** provision a new tenant via UI → tenant
admin gets invite email → can sign in → sees only their data; suspend
tenant → their users blocked from sign-in; assume-identity logs to
audit log.

---

### BL-16 — Platform Configuration (tier model)
**Priority:** P1  ·  **Effort:** L (phased)  ·  **Depends on:** BL-15

Per spec: "tailor offerings with promotions and various levels:
Bronze, Silver, Gold, Platinum, Custom."

**Phase A — Schema + default tier seed** ✅ shipped:
- Migration `0043_subscription_tiers.sql` adds:
  - `subscription_tier` table — id, slug (unique), name, description,
    price_monthly_cents (integer; cents to avoid floating-point pain),
    price_yearly_cents, feature_flags jsonb, quotas jsonb, sort_order,
    active, timestamps. Sort-order index.
  - `tenant_subscription` table — organization_id PK (one tier per
    tenant), tier_id FK, status enum, period dates, custom_overrides
    jsonb (per-tenant feature/quota overrides), notes, timestamps.
    Indexes on tier_id and status.
  - `tenant_subscription_status` enum — `trial / active / past_due /
    canceled / paused`.
- Five default tiers seeded with placeholder pricing (sales adjusts
  via Phase C admin UI): **Bronze** ($99/mo, limited),
  **Silver** ($249/mo, +Winner Analysis), **Gold** ($499/mo,
  all features unlocked), **Platinum** ($999/mo, unlimited
  quotas), **Custom** (admin-configured per-tenant overrides).
- Feature flags: `aiAutoDraft`, `winnerAnalysis`, `complianceMatrix`,
  `bulkExport`, `apiAccess`, `customTemplates`.
- Quotas: `aiRequestsPerMonth`, `seatsIncluded`, `storageGb`,
  `proposalsPerMonth` (0 = unlimited semantics).
- **Backfill**: every existing organization gets a Platinum
  subscription so runtime behavior is unchanged when Phase B
  introduces feature gates. Idempotent insert (NOT EXISTS guard).
- TypeScript types exported: `TierFeatureFlags`, `TierQuotas`,
  `SubscriptionTier`, `TenantSubscription`, `TenantSubscriptionStatus`.
- Isolation check: `tenant_subscription` correctly auto-detected as
  tenant-scoped (29 tables now).

**Phase B-1 — `ensureFeature` helper + first gated action + tier panel** ✅ shipped:
- New `src/lib/subscription-gates.ts`:
  - `class FeatureGateError extends Error` with `featureKey` + `tierName` fields
  - `getCurrentTier(organizationId)` — joins `tenant_subscription` ×
    `subscription_tier`, applies `custom_overrides` on top, returns
    `{ tierId, tierName, tierSlug, status, featureFlags, quotas,
    overrides, effectiveFlags, effectiveQuotas }` or `null` when the
    org has no subscription row
  - `ensureFeature(orgId, key)` — throws `FeatureGateError` when the
    effective flag is `false`. Safe-by-default: no subscription row
    or DB error → deny (failing-open would leak gated features). If
    the tier is marked `active=false` (retired), every feature
    denies — operator must reassign the org first.
- Wired into `runWinnerAnalysisAction` (the most clearly tier-gated
  action per the spec). Catches `FeatureGateError` and surfaces the
  message via the existing `{ ok: false, error }` result shape — no
  thrown errors past the boundary. Existing tenants on Platinum
  (per Phase A backfill) keep working; new tenants on Bronze
  (winnerAnalysis: false) get a clean upgrade-prompt message.
- Per-tenant detail page `/admin/orgs/[id]` now shows a
  "Subscription tier" panel: current tier name, slug, status,
  effective AI-requests / seats quotas, whether per-tenant
  overrides exist. Hides quota numbers when the tier means
  unlimited (0).

**Phase B-2 — Wire `ensureFeature` into remaining gated actions** ✅ shipped:
- `generateSectionDraftAction` (AI section generation in
  `proposals/[id]/sections/ai/actions.ts`) gates on `aiAutoDraft`.
- `runCompliancePreflightAction` (AI compliance-rating pass in
  `proposals/[id]/compliance/actions.ts`) gates on
  `complianceMatrix`.
- `exportAuditLogCsvAction` (full-corpus audit-log CSV in
  `audit-log/actions.ts`) gates on `bulkExport`. The inline table
  view stays accessible; only the bulk download is gated.

Each gate uses the same try/catch pattern: catch `FeatureGateError`
→ return `{ ok: false, error: err.message }` via the existing
result shape; re-throw any other error. Platinum-tier tenants (every
existing org per Phase A backfill) see no behavior change.

Still ungated (deferred — flags exist but features aren't yet
built or need design work):
- `apiAccess` — no token endpoint exists yet
- `customTemplates` — gating semantics need design (view-only vs.
  create-only)

**Phase B-3a — Quota counter schema + helper** ✅ shipped:
- Migration `0044_tenant_usage_counter.sql` adds the
  `tenant_usage_counter` table — composite PK on
  `(organization_id, key, period_start)` + `period_end` + `value`
  (integer counter) + `updated_at`. One row per tenant per quota
  key per month.
- Period semantics: calendar month, UTC. `period_start` = first of
  the month at 00:00 UTC; `period_end` = first of next month.
- Drizzle table + `TenantUsageCounter` / `NewTenantUsageCounter`
  types exported. Isolation check now reports 30 tables.
- `enforceQuota(orgId, key, delta = 1)` helper in
  `src/lib/subscription-gates.ts`:
  - Reads the tenant's effective quota for `key` (tier × overrides).
  - Quota = 0 → unlimited; returns early with no DB write.
  - Atomic UPSERT (`INSERT ... ON CONFLICT DO UPDATE SET value =
    value + EXCLUDED.value RETURNING value`) so concurrent calls
    compose correctly without lost updates.
  - Throws `QuotaExceededError` when `used > limit` (after the
    increment — over-quota usage is recorded for forensics; the
    gate's job is to refuse the NEXT call).
- `getCurrentUsage(orgId, key)` — read-only counter peek for admin
  dashboards.
- `CounterQuotaKey` type narrows the keys to those that map to a
  counter row (`aiRequestsPerMonth`, `proposalsPerMonth`).
  `seatsIncluded` + `storageGb` are measured live from their source
  tables (memberships + knowledge_artifact.file_size respectively)
  and don't need counter rows.

**Phase B-3b — Wire `enforceQuota` into call sites** ✅ shipped:
- `aiRequestsPerMonth` bumped from the three Phase B-2 gated AI
  actions (winner analysis, AI section draft, compliance preflight).
  Counter increments on every attempt, including failed AI calls —
  simpler call pattern at the cost of slightly inflated counts on
  network errors. Refund semantics queued if accuracy ever matters.
- `proposalsPerMonth` bumped from `createProposalAction`.
- Each gated action catches `QuotaExceededError` and surfaces the
  upgrade-prompt message via the existing `{ ok: false, error }`
  result shape.
- Existing Platinum tenants (every existing org per Phase A
  backfill) see no behavior change — Platinum has all quotas = 0
  which means unlimited; `enforceQuota` short-circuits to allow
  without writing a counter row.

**Phase B-3c — Live-measure quotas (seats + storage)** ✅ shipped:
- `QuotaExceededError` widened to accept any `QuotaKey` (counter or
  live-measure) plus an optional `customMessage` for tailored
  upgrade prompts.
- New helpers in `src/lib/subscription-gates.ts`:
  - `getActiveMembershipCount(orgId)`
  - `getStorageBytesUsed(orgId)`
  - `enforceSeatsQuota(orgId)` — throws when active count `>=`
    limit. `seatsIncluded = 0` means unlimited.
  - `enforceStorageQuota(orgId, additionalBytes)` — throws when
    used + new file would exceed limit. Tier values are GB; helper
    converts to bytes (1 GB = 1024³) for comparison.
- Wired into:
  - `inviteUserAction` (`users/actions.ts`) — seats. Live-measured,
    so removing a user frees a seat immediately.
  - `uploadKnowledgeArtifactAction` (`knowledge-base/import/actions.ts`)
    — storage. Live-measured, so deleting an artifact frees space
    immediately.

**Phase B-3d — Refund semantics** ✅ shipped (PR #225):
- New `refundQuota(orgId, key, count = 1)` helper in
  `subscription-gates.ts`. Atomic decrement with `GREATEST(0, ...)`
  clamp so a stray refund never produces a negative counter. No-op
  when count ≤ 0, tier quota = 0 (unlimited — no row), or no row
  exists for the current period. Best-effort: failures log + return,
  never throw.
- Wired into the four upfront-charge call sites where the original
  Phase B-3b implementation noted "counts every attempt":
  - `generateSectionDraftAction` — AI call failure OR empty response
  - `runWinnerAnalysisAction` — AI call failure OR rate-limited
  - `runCompliancePreflightAction` — no mapped items OR zero
    assessments produced OR rate-limited
  - `createProposalAction` (`proposalsPerMonth`) — INSERT returned
    no row OR threw before the proposal row landed. `proposalCreated`
    flag prevents refund when downstream sections/audit/dispatch
    fails after the proposal already exists.

**Phase C-1 — Read-only tier list page** ✅ shipped:
- New `/admin/tiers` route, superadmin-only. Lists every
  `subscription_tier` row with: slug, name, description, monthly
  + yearly price (formatted from cents), feature summary (enabled
  flags), quota summary (with "Unlimited" for 0), active/retired
  pill, sort_order, and the count of tenants currently on that
  tier.
- Single GROUPed query for per-tier tenant counts; merged into a
  Map for O(1) lookup at render time.
- "Tiers →" link added to the SuperAdmin portal header next to
  Migrations / Source requests / SBA 8(a) / Audit log.
- Read-only — Phase C-2 ships per-tenant assignment, Phase C-3
  ships the tier editor that mutates these rows.

**Phase C-2 — Per-tenant tier assignment UI** ✅ shipped:
- New server actions in `admin/orgs/[id]/actions.ts`:
  - `changeTenantTierAction({ organizationId, tierId })` — validates
    target tier exists + is active + differs from current, updates
    `tenant_subscription.tier_id`, writes a `tenant.tier_change`
    audit row into the *target* tenant's log with `fromTier` and
    `toTier` metadata, revalidates the org detail + the tier list.
  - `listActiveTiersAction()` — read-only list of active tiers in
    sort-order for the dropdown.
- New client component `TierAssignmentForm` renders the dropdown
  + Change tier button + browser confirm dialog + result banners
  (success: emerald, error: rose).
- Wired into `/admin/orgs/[id]` below the existing Subscription
  tier panel. Only renders when `currentTier` is resolved AND there
  are >=2 active tiers (no point showing a dropdown with one option).

**Phase C-3 — Tier editor** ✅ shipped:
- New route `/admin/tiers/[id]` — superadmin-only edit page.
  PageHeader shows status (Active/Retired), tenant count, sort
  order. notFound() if the id doesn't resolve.
- `TierEditForm` client component with fields for:
  - Name (text, max 64)
  - Description (textarea, max 500)
  - Price (monthly + yearly) — entered as USD dollars, converted
    to cents on submit (`Math.round(usd * 100)`)
  - Feature flags — 6 checkboxes (one per `TierFeatureFlags` key)
  - Quotas — 4 number inputs (one per `TierQuotas` key); 0 means
    unlimited per the standing convention
  - Sort order (integer)
  - Active (checkbox)
  - Slug rendered read-only — slugs are referenced by seeds + future
    billing integrations; create a new tier if you need a different
    slug rather than renaming.
- Server action `updateTierAction(tierId, input)`:
  - zod validation on every field
  - **Refuses retire** (active true → false) when any tenant is
    still on this tier. Forces the explicit "reassign first"
    workflow rather than silently breaking AI/quota resolution
    for those tenants.
  - Audits as `subscription_tier.update` into the actor's primary
    org's audit log. Pure-superadmins (no org) get a structured
    `log.info` instead of a DB row — tier edits are rare. A
    cross-tenant `platform_audit` surface is queued separately.
  - Revalidates `/admin/tiers` and `/admin/tiers/[id]`.
- "Edit →" link added to each row of the `/admin/tiers` list.

**Phase C-4 — Promotional codes (CRUD)** ✅ shipped:
- Migration `0045_promo_codes.sql` adds the `promotion_code` table:
  id uuid PK, code varchar(64) unique (case-sensitive to avoid
  L/I/0/O ambiguity at redemption), description, discount_percent
  (0–100), valid_from / valid_until (nullable — null = no bound),
  max_uses (0 = unlimited), times_used (counter, default 0),
  active boolean, timestamps. Index on created_at DESC for the
  admin list view.
- Drizzle table + `PromotionCode` / `NewPromotionCode` types.
- Server actions `createPromoCodeAction` / `updatePromoCodeAction`
  with zod validation (code regex `[A-Za-z0-9_-]+`, length bounds,
  discount 0–100). Surfaces unique-violation as a friendly error.
  Audits as `promo_code.create` / `promo_code.update` into the
  actor's primary org log (pure-superadmins → structured `log.info`).
- UI:
  - `/admin/promo-codes` — list view with status pills (Active /
    Inactive / Expired / Maxed out / Usable). Each row links to
    edit. Header has + New code + meta tiles (total codes, active
    count, total redemptions across all codes).
  - `/admin/promo-codes/new` — create form.
  - `/admin/promo-codes/[id]` — edit form. notFound() on missing id.
- `PromoCodeForm` client component handles both modes; date inputs
  for validity window; checkbox for active; non-negative integer
  inputs for discount + max uses with explicit "0 = unlimited"
  hint label.
- "Promo codes →" link added to the SuperAdmin portal header next
  to Tiers.

**What ships in a later phase**: the actual redemption flow
(applying a code to a `tenant_subscription` to discount the next
period's price). Redemption pairs with **BL-17** billing
integration; the code data model is in place for when that lands.

**Acceptance (full ticket):** create Custom tier with
`aiRequestsPerMonth=0` (treated as deny under Phase B semantics;
Phase A keeps 0 = unlimited) → assign to test tenant → tenant cannot
run any AI feature → upgrade to Gold → AI features work.

---

### BL-17 — Subscriptions module
**Priority:** P1  ·  **Effort:** L  ·  **Depends on:** BL-16

Per spec: "currently active subscriptions, trials, subscription
types, and expiring subscriptions."

**Scope:**
- Stripe (or Paddle / Lemon Squeezy — decision pending) integration
- Webhook handler for `customer.subscription.{created,updated,deleted}`
- Trial management: 14-day default; configurable per tier; expiry
  notifications via BL-13
- Per-tenant billing portal link
- Super-admin view: filter by tier, status (active/trial/past_due/
  canceled), expiry window (next 7/30/90 days)
- Failed-payment dunning (Stripe handles, we surface state)
- Manual override for Custom-tier billing (offline billing supported)

**Acceptance:** test tenant signs up via Stripe checkout → webhook
creates `tenant_subscription` row → tier features active; cancel
mid-month → access remains until period end; renewal extends.

---

### BL-18 — Platform Audit Log (cross-tenant) — **shipped**
**Priority:** P1  ·  **Effort:** S  ·  **Depends on:** BL-12  ·  **Status:** ✅ shipped

Cross-tenant super-admin view of the BL-12 audit log.

**Shipped:**
- ✅ `/platform/audit-log` route under super-admin gate
  (`requireSuperadmin()`)
- ✅ Server actions: `listPlatformAuditEventsAction`,
  `listPlatformAuditTenantsAction`, `listPlatformAuditActorsAction`,
  `exportPlatformAuditLogCsvAction`
- ✅ Filters: full-text search, tenant, actor (with org tag),
  resource type, **category (read / mutation)**, from/to dates
- ✅ "Events by tenant" panel on the page surfaces top-20 tenants by
  event volume; click-through filters the table to that tenant
- ✅ Table includes tenant column with name + slug; read events
  carry a small `read` chip so anomalies are visible at a glance
- ✅ CSV export includes tenant + slug columns (capped 50,000 rows)
- ✅ Nav restructure: "Platform Administration" leaf converted to a
  parent group with **Tenants** (`/admin`) + **Audit Log**
  (`/platform/audit-log`) children. Pending BLs (BL-15 / BL-16 /
  BL-17) will add more children here.

**Deferred (separate ticket):** The legacy `AuditLogTab` in
`/admin` (synthesizes events from raw table activity via
`getRecentAuditEvents`) is **not** removed by this PR. Different
data model than the BL-12 `audit_log` table — the legacy tab shows
derived events (`org_created`, `proposal_updated`) timestamped from
the originating table's `createdAt`, while the new view shows
actual recorded actions with actor IPs, user-agents, and metadata.
Tracked as **BL-18-cleanup**.

**Acceptance:** ✅ Every BL-12 row visible to super-admin regardless
of tenant; per-tenant filter works; CSV export functional.

---

### BL-18-cleanup — Retire legacy AdminClient AuditLogTab — **shipped**
**Priority:** P3  ·  **Effort:** S  ·  **Depends on:** BL-18  ·  **Status:** ✅ shipped

The synthesized event feed in `AdminClient.tsx`'s `AuditLogTab` was
superseded by the BL-18 viewer. Retiring it earlier than the
originally-planned 30-day soak window — the BL-18 viewer reads the
same data the new tab needed and is already wired up.

**Shipped:**
- ✅ Deleted `src/app/(app)/admin/AuditLogTab.tsx`
- ✅ Deleted `src/lib/admin-audit.ts` (only caller was `admin/page.tsx`)
- ✅ Removed the `audit` tab + `AuditEvent` import + `auditEvents`
  prop from `AdminClient.tsx`; trimmed the `Tab` union accordingly
- ✅ Removed the `getRecentAuditEvents` call from `admin/page.tsx`
  (and the prop pass)
- ✅ Added an **Audit log →** link to the SuperAdmin portal header
  pointing at `/platform/audit-log`, alongside the existing
  Migrations / Source requests / SBA 8(a) links
- ✅ Updated the docstring on `platform/audit-log/actions.ts` to
  mark the legacy tab as retired (past tense)

**Acceptance:** ✅ Legacy code removed; SuperAdmin portal links to
the BL-18 view; no regression in the tenants page.

---

## Cross-cutting / foundation

### BL-19 — Multi-tenant isolation continuous verification

**Phase 1: static analyzer ✅ SHIPPED**

`scripts/check-isolation.mjs` runs in CI on every PR. It derives the
set of tenant-scoped tables from the migrations (anything with an
`organization_id` column), then walks every "use server" file and
asserts each exported async function that touches a scoped table:

- calls an auth gate (`requireAuth` / `requireCurrentOrg` /
  `requireOrgAdmin` / `requireOrgMember` / `requireSuperadmin`)
- references `organizationId` inside the function (the query must
  scope by org)

Legitimate exceptions (public token-scoped surfaces, etc.) live in
`.isolation-allow.json` with a one-line documented reason. The first
run flushed out one real isolation bug (`getDefaultTemplate` took
`organizationId` as a parameter in a "use server" file, exposing it
as a client-callable endpoint) which was fixed in the same PR by
moving the helper into `src/lib/`.

**Phase 2 (deferred) — runtime tests:**
- Test harness: provisions 2 tenants with seed data
- For every scoped table, runtime assertions that a tenant-A user
  invoking any server action cannot read/update/delete tenant-B rows,
  including via foreign key references
- Belongs in a follow-up after a test framework lands

---

### BL-QC — Robotic pre-merge quality gates — **shipped**
**Priority:** P0  ·  **Effort:** S  ·  **Status:** ✅ shipped

Adds layered pre-merge gates so quality control isn't dependent on
human discipline. Each gate is a separate required status check on
`main`; failure blocks merge automatically.

Motivated by the four-parallel-PR rebase cascade after BL-8 / BL-21 /
BL-18-cleanup — repeated "branch out-of-date" friction surfaced that
the existing safety stack relied on me being disciplined, not on the
repo enforcing the discipline. This ticket closes that.

**Shipped:**
- `.github/workflows/pr-quality.yml` — five independent jobs:
  - PR title format (conventional-commit prefix)
  - Backlog hygiene (PRs referencing `BL-N` must touch `docs/BACKLOG.md`)
  - Schema / migration coupling (`src/db/*.ts` changes require a new `drizzle/[0-9]+_*.sql`; `schema-no-migration` label bypasses)
  - Diff-size guard (PRs over 1,500 LOC blocked; `oversized-ok` label bypasses)
  - Secret scan (regex on newly-added non-doc lines)
- `.github/CODEOWNERS` — security-critical paths (`src/db/`,
  `drizzle/`, auth primitives, audit log, isolation enforcement,
  `.github/`) routed to `@SYSUSA1NC`; combined with branch
  protection's "Require review from Code Owners," these paths
  require explicit approval on top of the robotic checks.
- `docs/PR_QUALITY.md` — describes each gate, the bypass-label
  semantics, how to add a new gate, and the recommended branch-
  protection settings.

**Operator follow-up (one-time, in Settings → Branches → main):**
- Add each Tier 2 job's display name to required status checks
  (ESLint, PR title format, Backlog hygiene, Schema / migration
  coupling, Diff-size guard, Secret scan, Drizzle schema validate,
  Pre-push self-review section)
- ~~Add `Vercel Agent Review` to required status checks~~ —
  superseded by BL-QC-vercel-agent-retired; Vercel Agent is no
  longer used (see below)
- Enable "Require review from Code Owners" — **deferred until
  team is ≥2 humans** (GitHub blocks self-approval; would
  permanently block merge for a solo dev)
- Disable admin bypass on protection rules

**Acceptance:** ✅ Every future PR clears secret scan, conventional-
commit title check, backlog hygiene, schema-migration coupling, diff-
size guard, drizzle schema validate, pre-push self-review section,
and the existing Tier 0 CI gates before merge is enabled. No admin
escape hatch.

---

### BL-QC-lint — ESLint as a required gate — **shipped**
**Priority:** P1  ·  **Effort:** S  ·  **Depends on:** BL-QC  ·  **Status:** ✅ shipped

**Shipped:**
- `.eslintrc.json` extending `next/core-web-vitals` + `next/typescript`
  presets, with `@typescript-eslint/no-unused-vars` strict + the
  `^_` ignore prefix for legitimate unused args/vars
- `eslint` + `eslint-config-next` added as devDependencies
- Fixed 15 pre-existing violations across `src/app/(app)` and `src/lib`:
  unused imports trimmed, unused destructured setters prefixed with
  `_`, unused function parameters prefixed with `_`. No behavior
  change in any file.
- ESLint job added back to `.github/workflows/pr-quality.yml` —
  becomes the 6th Tier-2 gate.

**Operator follow-up:** add `ESLint` to required status checks in
Settings → Branches → main.

**Acceptance:** ✅ `npm run lint` exits clean on `main`; PRs must
pass it before merge.

---

### BL-QC-deeper — Drizzle schema validate — **shipped**
**Priority:** P1  ·  **Effort:** S  ·  **Depends on:** BL-QC, BL-QC-lint  ·  **Status:** ✅ shipped

Adds `drizzle-kit check` as the 7th Tier-2 gate. Validates that the
recorded schema snapshots (`drizzle/meta/*.json`) are internally
consistent — no duplicate snapshot prefixes, no orphan journal
entries, no schema/snapshot mismatch.

**Shipped:**
- New `drizzle-validate` job in `.github/workflows/pr-quality.yml`
- Documented in `docs/PR_QUALITY.md`

**Limitation:** the project applies migrations 0018+ via
`scripts/apply-schema.mjs` rather than `drizzle-kit migrate`, so the
journal stopped at 0017. `drizzle-kit check` only validates the
journaled portion. The existing `Fresh-DB migration verification`
remains the gold-standard validation because it actually runs every
SQL file against a real Postgres.

**Operator follow-up:** add `Drizzle schema validate` to required
status checks in Settings → Branches → main.

---

### BL-QC-neon — Neon branch per PR — **shipped (workflow); operator setup pending**
**Priority:** P1  ·  **Effort:** M  ·  **Depends on:** BL-QC  ·  **Status:** ✅ workflow shipped; awaits operator config

**Shipped:**
- New workflow `.github/workflows/neon-branch.yml`:
  - On PR `opened` / `reopened` / `synchronize`: creates a Neon
    branch named `pr-<number>` off the project's parent branch
    (default `main`) using `neondatabase/create-branch-action@v6`
  - Posts a PR comment with the password-masked connection string
    (idempotent — updates the existing comment on subsequent syncs
    rather than spamming new ones)
  - On PR `closed`: deletes the branch via
    `neondatabase/delete-branch-action@v3`
- **Soft-skip when not configured** — both lifecycle jobs detect
  missing `NEON_API_KEY` or `NEON_PROJECT_ID` and exit cleanly with
  a `::notice::` annotation. The workflow is safe to merge before
  operator setup.
- Documented in `docs/PR_QUALITY.md` with the full setup checklist.

**Operator follow-up (one-time, Settings → Secrets and variables → Actions):**
- Add secret `NEON_API_KEY` (from Neon console → account → API keys)
- Add variable `NEON_PROJECT_ID` (from Neon console → project → settings)
- Optional: `NEON_BRANCH_PARENT`, `NEON_USERNAME`
- Optional but recommended: connect the Vercel project to the Neon
  project via the official Vercel-Neon integration; preview deploys
  will then auto-use the per-PR branch
- Add `Create Neon branch` + `Delete Neon branch` to required
  status checks in Settings → Branches → main

**Future follow-up (BL-QC-neon-migration-rewire):** modify the
existing `Fresh-DB migration verification` job in `pr.yml` to use
the per-PR Neon branch when configured (falling back to the
ephemeral Postgres service when not). That gives migrations a test
against real production schema/data shape, not an empty Postgres.
Split out as its own ticket because it depends on this workflow
being live + verified working.

**Acceptance:** ✅ Opening a PR creates a Neon branch (once
configured); closing/merging deletes it; the connection string is
posted as a PR comment. Vercel preview auto-uses the branch via the
Neon integration. Migration-rewire deferred.

---

### BL-QC-neon-migration-rewire — Use Neon branch for fresh-DB check — **shipped**
**Priority:** P2  ·  **Effort:** S  ·  **Depends on:** BL-QC-neon  ·  **Status:** ✅ shipped

Follow-up to BL-QC-neon. `pr.yml`'s `migrations-fresh` job now
prefers the per-PR Neon branch's connection string when Neon is
configured, giving the migration test real production schema shape.

**Shipped:**
- New `Detect Neon configuration` step emits `configured=true/false`
  based on `secrets.NEON_API_KEY` + `vars.NEON_PROJECT_ID` presence.
- New `Resolve Neon branch` step (gated on `configured == 'true'` and
  `github.event_name == 'pull_request'`) calls
  `neondatabase/create-branch-action@v6` with the same
  `branch_name: pr-<number>` the neon-branch workflow uses. The
  action is idempotent on `branch_name` — if neon-branch.yml already
  created the branch, this call returns the existing connection
  details rather than failing. Parallel-safe.
- `Run fresh-DB migration check` step's `DATABASE_URL` picks the
  Neon `db_url` when resolved and falls back to the ephemeral
  `pgvector/pgvector:pg16` service URL otherwise — preserves the
  existing behavior for forks / setups without Neon access.
- `services: postgres` block kept as the fallback target; always
  boots (services run for the whole job) but is unused when the
  Neon path resolves. Trade-off accepted: ~5–10s of CI time on
  Neon-configured runs vs. splitting into two parallel jobs.

---

### BL-QC-combined-job — Consolidate typecheck + lint
**Priority:** P3  ·  **Effort:** S  ·  **Depends on:** BL-QC-lint  ·  **Status:** queued

Cosmetic CI cleanup — combine the separate `typecheck` (in `pr.yml`)
and `lint` (in `pr-quality.yml`) jobs into one job-run for slightly
faster CI. No power change; just one less `npm ci` per PR.

---

### BL-QC-vercel-agent-retired — Retire Vercel Agent, keep the checklist — **shipped**
**Priority:** P1  ·  **Effort:** S  ·  **Depends on:** BL-QC  ·  **Status:** ✅ shipped

Vercel Agent's "Code Reviews" (Beta) was costing ~$25/mo via the
team's auto-reload credit. Over the previous ~40 PRs the agent
contributed ~11 real catches, all of which had been engrained as
categories in `.vercel/agent.md` — meaning the lessons survived
without the bot continuing to post on every PR.

**Cost decision:** turn off both Vercel Agent toggles (Code Reviews +
Investigations) in **Team Settings → Agent**. Repurpose the in-repo
footprint as an author-discipline checklist + remove machinery that
only existed to handle agent-specific behavior.

**Changes in this PR:**
- Move `.vercel/agent.md` → `docs/PRE_PUSH_CHECKLIST.md` and reframe
  as a self-review checklist (categories unchanged; intro/history
  updated)
- Remove `.github/workflows/auto-resolve-outdated.yml` (no-op once
  Vercel Agent stops posting threads)
- Update `.github/PULL_REQUEST_TEMPLATE.md` self-review table header
  to reference the new file path
- Update the BL-QC-self-review-gate comment in
  `.github/workflows/pr-quality.yml`
- Drop the Tier 1 "Vercel Agent Review" row from `docs/PR_QUALITY.md`
  and the operator-setup line that suggested promoting it to a
  required check
- Drop §9 "Responding to Vercel Agent suggestions" from
  `docs/ENGINEERING_STANDARDS.md`; replace with "Author self-review
  before push"
- Drop the Vercel Agent row from §7 Tier 1 in
  `docs/ENGINEERING_STANDARDS.md`
- Update `AGENTS.md` to remove the Vercel Agent reference and correct
  the gate-count line (8 in `pr-quality.yml` + 5 in `pr.yml` +
  Vercel Preview deploy + CODEOWNERS)

**Out of scope (operator follow-up):**
- Toggle off Code Reviews + Investigations in Vercel team settings
  (done outside the PR)
- Remove "Vercel Agent Review" from branch protection's required
  status checks (was never added; nothing to remove)

**What replaces it:**
- **Static gates** (13 required, see PR_QUALITY.md) cover most of what
  the agent caught
- **`docs/PRE_PUSH_CHECKLIST.md`** is the human-discipline layer for
  what gates can't catch (audit calls, isolation in the `where`,
  export completeness, inbox parity, etc.) — same content, now
  enforced via the Pre-push self-review CI gate
- **Sentry free tier** (separate PR) covers the runtime-error gap
  Vercel Agent's Investigations toggle attempted to fill

**Acceptance:** ✅ The next PR after this lands does not show a
"Vercel Agent Review" check, and the Pre-push self-review gate keeps
passing against the renamed file. Self-review template header reads
`Concern from docs/PRE_PUSH_CHECKLIST.md`. No machinery exists in the
repo that runs only against Vercel Agent activity.

---

### BL-QC-sentry — Sentry free-tier runtime error capture — **retired**
**Priority:** P1  ·  **Effort:** S  ·  **Depends on:** BL-QC-vercel-agent-retired  ·  **Status:** ⛔ retired (PR #193 merged then reverted)

Wiring shipped in PR #193 but the user redirected to "skip Sentry and
remove any reference" before the merge happened. The merge went
through anyway by accident. Retired in BL-QC-sentry-retire (this PR).

**Why retired:** the user's framing "Sentry is more like an audit log
than anything else" matched our existing infrastructure exactly —
we already have a tenant-scoped `audit_log` table, an `/admin/audit-log`
viewer, and email infrastructure. Building the same pattern as
`production_error` gives Sentry-equivalent functionality with zero
external SaaS dependency, no quota cap, no monthly cost (Sentry's
free tier is generous but Vercel-bundled Sentry was auto-reloading
$25/mo via "Investigations" credit even before active use).

**Replaced by:** `BL-QC-errors` — in-app `production_error` table +
`/admin/errors` viewer (follow-up PR after this one lands).

---

### BL-QC-sentry-retire — Rip Sentry from the codebase — **shipped**
**Priority:** P0  ·  **Effort:** S  ·  **Depends on:** BL-QC-sentry  ·  **Status:** ✅ shipped

Restores the cost-conscious posture established when Vercel Agent was
retired (BL-QC-vercel-agent-retired). Sentry crept back in via PR #193
which was merged after I marked it closed but before the close took
effect. This PR cleanly removes every Sentry surface so future searches
of the codebase don't surface "is Sentry coming back?" ambiguity.

**Removed:**

- `@sentry/nextjs` ^10.57.0 dependency (npm uninstall)
- `sentry.client.config.ts`, `sentry.server.config.ts`,
  `sentry.edge.config.ts` at repo root
- `withSentryConfig` wrap around `next.config.mjs`
- Sentry imports + `captureRequestError` re-export from
  `src/instrumentation.ts`
- `docs/SENTRY_SETUP.md`
- Sentry mentions in `src/lib/log.ts` comments
- Sentry mentions in audit docs (`05-code-quality.md`,
  `FIX_PLAN.md`, `SUMMARY.md`); recommendations re-pointed at
  the in-app error log (BL-QC-errors)

**Not removed:** the `production_error` table from the upcoming
BL-QC-errors PR. That's the replacement, lands as a separate PR.

**Acceptance:** ✅ `grep -ri sentry .` from the repo root returns only
historical mentions in BACKLOG.md (i.e., this entry + BL-QC-sentry).
No code, no config, no docs reference Sentry as an active dependency.

---

### BL-QC-errors — In-app production error log — **shipped**
**Priority:** P1  ·  **Effort:** M  ·  **Depends on:** BL-QC-sentry-retire  ·  **Status:** ✅ shipped

Replaces what an external observability backend (e.g., Sentry —
retired in BL-QC-sentry-retire) would give us. Same mental model as
the existing `audit_log` table — uncaught exceptions land in a
platform-wide `production_error` table, deduped by a SHA-256
fingerprint of the stack trace's top 5 frames so 1000 firings of the
same bug collapse into 1 row with `occurrenceCount = 1000`.

Surfaced 2026-06-14 when `/settings` and `/notifications/rules`
silently 500'd from schema drift. The crashes were invisible until a
user clicked them. With this in place, future similar crashes appear
at `/admin/errors` immediately on the first occurrence, before
anyone has to click anything to discover them.

**What ships:**

- `drizzle/0049_production_error_log.sql` — `production_error` table
  with fingerprint-based dedup, partial index on unresolved rows,
  cascade-set-null for org / user / actor references
- `src/db/schema.ts` — `productionErrors` Drizzle binding
- `src/lib/error-log.ts` — `captureProductionError(input)` with
  SHA-256 fingerprint over top 5 stack frames (line/column markers
  stripped for cross-deploy stability), UPSERT-based dedup via
  `onConflictDoUpdate`, noise-filter (NEXT_REDIRECT, AbortError,
  ResizeObserver loops, browser-extension paths)
- `src/app/global-error.tsx` — root error boundary. POSTs to
  `/api/error-report` fire-and-forget. Minimal styled fallback
  page with the Next.js `digest` reference
- `src/app/api/error-report/route.ts` — public endpoint (allow-listed
  in `auth.config.ts`) that captures client-side errors. Returns
  204 unconditionally so the report endpoint never errors during an
  already-broken page render
- `src/app/(app)/admin/errors/page.tsx` — superadmin viewer with
  filter by status (unresolved/acknowledged/resolved/all) + env
  (production/preview/development). Top-line counts: total issues,
  unresolved, unacknowledged, total occurrences
- `src/app/(app)/admin/errors/ErrorRowActions.tsx` — per-issue
  acknowledge / resolve / re-open / add-notes
- `src/app/(app)/admin/errors/actions.ts` — server actions for the
  four triage operations. Allow-listed in `.isolation-allow.json`
  with rationale (platform-wide ops data, not tenant-scoped)
- `src/app/(app)/admin/AdminClient.tsx` — "Errors →" nav link in
  the SuperAdmin portal action bar

**What this is NOT:**

- Server-side auto-capture from server actions / route handlers /
  RSC. Next 14 doesn't have an `onRequestError` hook (Next 15
  feature). Explicit `captureProductionError(...)` calls in catch
  blocks are the migration path; can sweep the existing 99
  `log.error` sites in a follow-up if needed
- Performance monitoring / profiling — out of scope. Cron timing
  observability lives in the cron handlers' structured log lines
- Cross-tenant tenant visibility — production_error is platform-wide,
  not tenant-scoped. Tenant admins don't see it. Superadmin only.

**Cost-conscious posture:**

- Zero external SaaS dependency. Lives in the existing Neon DB.
- Dedup means runaway error storms can't balloon table size (1
  fingerprint = 1 row, even at 1M occurrences)
- Partial index on `resolved_at IS NULL` keeps the default
  "show me what needs attention" query fast even after the
  resolved-history grows large
- Pre-write `shouldIgnore` filter drops the same kinds of noise
  Sentry's `ignoreErrors` config would have dropped (Next framework
  signals, browser-extension exceptions, ResizeObserver loops,
  AbortError)

**Acceptance:** ✅ A deliberate uncaught error in a client component
shows up at `/admin/errors` within a few seconds of the page render.
Re-triggering produces `occurrenceCount = 2` on the same row, not a
new row. Acknowledge / Resolve transitions the row's status filter
group. Notes save and persist across page loads. A new occurrence on
a previously-resolved fingerprint un-resolves the row (so a "fixed"
bug coming back is visible).

---

### BL-QC-errors-autocapture — Wire `log.error` into `production_error` — **shipped**
**Priority:** P1  ·  **Effort:** XS  ·  **Depends on:** BL-QC-errors  ·  **Status:** ✅ shipped

BL-QC-errors landed the `production_error` table + admin viewer, but
the 99 existing `log.error(...)` catch sites in the codebase still
only wrote to Vercel logs — they didn't populate the new in-app
viewer. This PR closes that gap with a minimal-touch wiring rather
than a 99-site sweep.

**What ships:**

- `src/lib/error-log.ts` — `ErrorCaptureInput` gains an optional
  `tag` field. When set, the stored message is prefixed `[tag] ...`
  so the admin viewer surfaces the call-site identifier
- `src/lib/log.ts` — when `log.error(tag, msg, { error })` is called
  with an `Error` instance in `ctx.error`, a fire-and-forget
  `captureProductionError({ error, tag, runtime: "server" })` runs
  alongside the structured log line. Node-only (skips on Edge
  runtime where pg isn't available) + recursion-guarded (the
  meta-error path inside captureProductionError can't loop)

**Behavioral change:** every existing `log.error("[X]", "msg",
{ error: err })` call automatically populates `/admin/errors` from
now on. Same fingerprint-dedup + noise-filter applies. No DB write
on `log.error` calls without an Error (operational signals stay
just-Vercel-logs).

**Why not a 99-site sweep:** mechanical, low-value per touch. The
wiring approach gives the same effect with one file change. Sites
that need richer context (e.g., requestPath, userId) can be
upgraded later to call `captureProductionError` directly with the
extra fields.

**Acceptance:** ✅ Triggering an exception inside any server action
that has the `log.error("[tag]", "msg", { error: err })` pattern
produces a row at `/admin/errors` within seconds, with message
prefixed `[tag] ...`. Subsequent occurrences of the same error
bump `occurrenceCount` rather than duplicating rows.

---

### BL-QC-schema-repair — Repair false-applied ledger entries — **shipped**
**Priority:** P0  ·  **Effort:** S  ·  **Depends on:** BL-QC-auto-migrate  ·  **Status:** ✅ shipped

Surfaced 2026-06-15 when `/admin/orgs/[id]` started returning 500 with
Postgres error `42P01 — relation "audit_log" does not exist`. The
`_forge_migration` ledger claimed migrations 0028, 0031, 0032, 0033,
0034 were applied, but the 7 tables they create were missing. Later
migrations (0035+) HAD applied — proving the database wasn't simply
behind, but in a partial state where the ledger lied.

**Root cause:** at some point an operator clicked the "Sync ledger"
affordance on `/admin/migrations` (the "orphan candidates" panel from
`MigrationsClient.tsx:73-162`). That affordance writes ledger entries
without running the SQL — designed for the case where a database was
migrated via `scripts/apply-schema.mjs` BEFORE the runtime ledger
existed. It was applied past the actual high-water mark, marking
0028-0034 as applied when their tables didn't yet exist.

**Immediate operator fix (2026-06-15 22:19 UTC):** operator ran the
idempotent recovery SQL via the Neon SQL Editor. The 7 missing tables
now exist on production. Audit log persistence works again,
`/admin/orgs/[id]` renders, recordAudit succeeds.

**This PR — SDLC closure:**

- New migration `drizzle/0052_repair_false_applied_ledger.sql` that
  idempotently re-creates the 7 missing tables. Mirrors the content
  of 0028, 0031, 0032, 0033, 0034 but every CREATE uses
  `IF NOT EXISTS`, every CREATE TYPE wraps in DO/EXCEPTION, every
  ADD CONSTRAINT wraps in DO/EXCEPTION. Safe to run anywhere:
    - On production where the hotfix SQL already ran → migration
      no-ops (every guard succeeds-as-skipped)
    - On a fresh deploy / restored backup → migration creates the
      tables, restoring the schema invariant
- Bumps `EXPECTED_LATEST_MIGRATION` in `src/lib/migration-check.ts`
  to `0052_repair_false_applied_ledger.sql` (was `0034_audit_log.sql`
  — long out of date)
- Documents the incident + root cause in the migration's header
  comment block for future readers

**Why this isn't a "band-aid":**

- The fix is in version control, reviewable as a PR, run through CI
  gates (TypeScript, lint, RSC, isolation, schema/migration coupling,
  fresh-DB migration verification)
- The auto-migrate pipeline (BL-QC-auto-migrate) will apply 0052 on
  the next cold start
- Fresh-DB CI runs every migration including 0052 from scratch, so
  the migration is exercised end-to-end before merge
- Reproducible — anyone bringing up a new environment gets the same
  schema state by running migrations through the ledger

**Acceptance:** ✅ The 7 tables exist on production. /admin and
/admin/orgs/[id] load. After this PR merges + auto-migrate cold-starts,
the ledger has 0052 applied. Fresh-DB CI passes (proves migration
0052 is idempotent + composes with 0000-0051).

**Hardening follow-up (queued, separate PR):**

- BL-QC-ledger-drift-detector — detect "ledger says applied but
  target table missing" on boot. Auto-recover where safe, refuse to
  start otherwise.
- Replace `/admin/migrations`'s "Sync ledger" UI with a per-file
  affordance that verifies the target table exists before marking
  applied. Or remove the UI entirely — it's a footgun.

---

### BL-QC-ledger-drift-detector — Detect + prevent ledger-vs-reality drift — **shipped**
**Priority:** P0  ·  **Effort:** S  ·  **Depends on:** BL-QC-schema-repair  ·  **Status:** ✅ shipped

Follow-up to BL-QC-schema-repair. Closes the loop on the 2026-06-15
incident by:

1. **Detecting** drift on every server cold start (so future
   "ledger says applied but target table missing" states are visible
   immediately in Vercel logs + `/admin/migrations` UI, not after
   the next user-triggered 500)
2. **Preventing** the original footgun by hardening the "Sync ledger"
   action to refuse marking migrations applied when their target
   tables don't actually exist

**Shipped:**

- `detectLedgerDrift()` in `src/lib/migration-runner.ts`:
  - For each ledger entry, reads the corresponding `drizzle/*.sql`
    file, extracts every `CREATE TABLE [IF NOT EXISTS] "name"`,
    and checks `pg_catalog.pg_tables` for each name
  - Returns `LedgerDriftFinding[]` listing `(filename, missingTables)`
    pairs
  - Read-only, never throws
- `tablesCreatedBy(content)` helper that strips comments and regex-
  matches CREATE TABLE statements. Used by both the drift detector
  and the hardened sync-ledger guard
- `markMigrationsAppliedThrough()` hardened — before inserting any
  ledger entries, verifies that the CREATE TABLE statements in each
  eligible migration target tables that actually exist. Refuses
  with a structured error message naming each violating file and its
  missing tables. The original footgun is now mechanically impossible
- `src/instrumentation.ts` — calls `detectLedgerDrift()` after the
  schema verify on every cold start. Logs `[ledger-drift]` error
  level when drift is detected
- `/admin/migrations` UI — new "⚠ Ledger drift" panel that surfaces
  the same findings inline. Operators see drift without leaving the
  admin portal

**Acceptance:** ✅ On a fresh cold start of a healthy DB, no
`[ledger-drift]` log entry appears. On a DB with the 2026-06-15
state (synthetic test), a single warn-level log line lists every
drifted migration. The hardened `markMigrationsAppliedThrough`
refuses to mark `0052` applied if `audit_log` doesn't exist
(verified via TypeScript test scenarios).

**Why this matters:** the 2026-06-15 incident was invisible for
days. By the time `/admin/orgs/[id]` 500'd, the drift had already
existed. With this in place, the next analogous drift surfaces in
the operator's Vercel logs + admin UI on the first cold start
after the drift is introduced — typically minutes after a bad sync,
not days.

---

### BL-QC-sync-ledger-retire — Remove "Sync ledger" UI affordance — **shipped**
**Priority:** P2  ·  **Effort:** XS  ·  **Depends on:** BL-QC-ledger-drift-detector  ·  **Status:** ✅ shipped

Final cleanup of the 2026-06-15 incident root cause. PR #203's
hardening (`markMigrationsAppliedThrough` refuses to mark applied
when target tables are missing) made the function safe, but the UI
affordance was still confusing and easy to misuse. This PR removes
the UI entry point entirely.

**Removed:**

- "Ledger sync needed?" amber panel in `MigrationsClient.tsx`
  (orphan-candidates detection, "Mark applied through" dropdown,
  "I VERIFIED" confirm input, "Sync ledger" button)
- All related client state: `syncing`, `lastSync`, `orphanCandidates`,
  `throughChoice`, `confirmText`, `confirmExpected`, `syncLedger()`
- `markMigrationsAppliedThroughAction` server action in
  `admin/migrations/actions.ts`

**Kept (intentionally):**

- `markMigrationsAppliedThrough()` low-level utility in
  `src/lib/migration-runner.ts` — hardened in PR #203 to refuse
  syncing past missing tables. Kept available for genuine
  emergencies (e.g., migrating a long-lived DB from a different
  ledger format) but no UI entry exists. Operators in such an
  emergency must deliberately construct the call, which is the
  intended friction.

Net diff: -167 LOC across 2 files.

**Acceptance:** ✅ `/admin/migrations` renders cleanly with only the
"Apply pending migrations" button + ledger list. No "Sync ledger"
panel, regardless of how many migrations are pending. The 2026-06-15
incident class is now mechanically impossible from the UI.

---

### BL-QC-auto-migrate — Auto-apply migrations on deploy with rollback gates — **shipped**
**Priority:** P0  ·  **Effort:** M  ·  **Depends on:** BL-QC  ·  **Status:** ✅ shipped

Surfaced after the 2026-06-14 production crash: /settings and
/notifications/rules returned 500 because the production DB was
missing migrations 0036–0048. Cause: migrations are committed in PRs
but auto-applied on production has never been wired — the operator
had to remember to run /admin/migrations after each merge. Days of
schema drift accumulated, then both surfaces broke as soon as a user
clicked them.

**Structural fix: auto-apply on every server cold start** with safety
guards so a bad migration does not auto-take-down production.

**Shipped:**

- tryAutoApplyMigrations() in src/lib/migration-runner.ts:
  - Skips when DISABLE_AUTO_MIGRATE=1 (escape hatch)
  - Skips when no pending migrations (returns in <100ms — common case)
  - Refuses when any pending migration contains destructive ops
    (DROP TABLE/COLUMN/TYPE/SCHEMA/DATABASE, TRUNCATE,
    ALTER COLUMN ... TYPE) — these require manual application
  - Single-flight via pg_try_advisory_lock(7240613514)
  - Takes a Neon branch snapshot before applying (if NEON_API_KEY +
    NEON_PROJECT_ID configured)
  - Never throws
- detectDestructiveOps(content) + scanPendingForDestructive() —
  static regex scan; surfaces blockers to the admin UI
- src/lib/neon-snapshot.ts — tryCreateBranchSnapshot() Neon REST
  API call with 10s timeout. No-op when NEON_API_KEY not set
- src/instrumentation.ts — fire-and-forget call to
  tryAutoApplyMigrations() followed by the existing schema verify
- /admin/migrations UI — new Auto-apply panel showing
  enabled/disabled, snapshot configuration, destructive blockers
- docs/MIGRATION_PROTOCOL.md — authoring rules, auto-apply mechanics,
  rollback procedures (mid-batch failure / downstream broken /
  logically-bad migration), Neon snapshot + PITR mechanics

**Rollback gates (per user request):**

1. **Destructive-op block** — DROP TABLE / DROP COLUMN / TRUNCATE /
   ALTER COLUMN TYPE / DROP TYPE / DROP DATABASE / DROP SCHEMA refused
   by auto-apply
2. **Per-migration transactions** — existing pattern; partial apply
   impossible
3. **Pre-apply Neon snapshot** — branch-as-snapshot before each batch;
   restore via Neon dashboard
4. **Compensating-migration doc convention** — no down-migrations;
   write a new forward migration to undo a bad one

**Forward-only philosophy:** no -- @down blocks. Industry consensus
is that down-migrations are hard to write correctly and encourage the
wrong mental model. Compensating migrations + snapshot-based rollback
is the modern norm.

**Operator follow-up (one-time, ~5 min):**

- Add NEON_API_KEY + NEON_PROJECT_ID to Vercel env (Production) if
  not already set for the per-PR Neon branch workflow. Both needed for
  snapshot-on-apply
- Decide on snapshot retention — manual prune for now; a future
  /api/cron/prune-snapshots cron can automate

**Acceptance:** ✅ Next deploy runs tryAutoApplyMigrations() on cold
start. With no pending migrations, returns silently in <100ms. With
pending non-destructive migrations, applies them + logs
[auto-migrate] applied N pending migration(s). With pending
destructive migrations, logs a warn and refuses, preserving the
manual /admin/migrations flow.

---

### BL-QC-auto-resolve — Auto-resolve outdated Vercel Agent threads — **shipped**
**Priority:** P0  ·  **Effort:** S  ·  **Depends on:** BL-QC  ·  **Status:** ✅ shipped

Fifth merge-block in a row (#143, #150, #153, #154, #155) traced
to the same pattern: Vercel Agent posts a comment, I fix in code,
the anchored line changes, GitHub marks the thread `isOutdated:
true` but leaves it `isResolved: false`. Branch protection's "All
comments must be resolved" then keeps blocking merge until someone
manually clicks Resolve.

Existing fixes (self-review gate, widened `.vercel/agent.md`) reduce
how often Vercel Agent finds something but don't eliminate it —
that's the agent's job. The remaining friction is the manual click
to acknowledge an outdated thread.

**Shipped:**
- `.github/workflows/auto-resolve-outdated.yml` — fires on PR
  `synchronize` / `opened` / `reopened`. Uses the built-in
  `GITHUB_TOKEN` to call GitHub's GraphQL `resolveReviewThread`
  mutation. Resolves threads where ALL of:
    - First comment's author is `vercel[bot]`
    - `isOutdated == true`
    - `isResolved == false`
  Leaves untouched:
    - Vercel Agent threads that are NOT outdated (live findings —
      must be addressed)
    - Human-reviewer threads (any state — preserves their authority)
    - Threads where Vercel Agent merely replied (first author is
      someone else)

**Not a bypass:**
- Vercel Agent still posts on every push
- Live (non-outdated) findings still block merge
- Human reviewer comments still block merge
- All Tier-0 + Tier-2 + Tier-3 gates unchanged
- "All comments must be resolved" branch protection rule stays
  exactly as configured

The workflow automates the click that GitHub has the data to make
(the anchored code changed) but doesn't auto-make in the general
case. For Vercel Agent specifically, an outdated thread on a fix
commit means "this was addressed."

**Operator follow-up:** none required. The workflow uses the
default `GITHUB_TOKEN`; no secret to configure. After merge, the
next PR with a Vercel Agent comment + fix-commit cycle should
auto-resolve without operator action.

**Acceptance:** ✅ Open a PR, get a Vercel Agent comment, push a
fix commit that changes the anchored line → workflow runs on the
synchronize event → thread auto-resolves → merge unblocks (assuming
other gates are green). Tested logic via the github-script @v7
GraphQL client; no separate test framework needed for a workflow
this focused.

---

### BL-QC-self-review-gate — Force the pre-push self-review checklist — **shipped**
**Priority:** P0  ·  **Effort:** S  ·  **Depends on:** BL-QC-guidelines  ·  **Status:** ✅ shipped

Surfaced after the same merge-blocking pattern hit three PRs in a
row (#143, #150, #153). Each time Vercel Agent caught a real issue
that a dry-run review against `.vercel/agent.md`'s checklist would
have caught earlier. Each time I verbally committed to running the
dry-run on the next PR. Each time I didn't.

**Shipped:**
- `.github/PULL_REQUEST_TEMPLATE.md` (new) — every PR opens with the
  required `## Pre-push self-review` section pre-populated. Author
  fills in each row with either `N/A` (category doesn't apply) or
  `addressed: <how>` (category applied + how it was handled).
- New `self-review-section` job in `.github/workflows/pr-quality.yml`
  — required Tier-2 gate that:
    1. Confirms the PR body contains `## Pre-push self-review`
    2. Confirms the section has ≥5 markdown table rows
    3. Confirms no row leaves the `<how>` placeholder unfilled
    4. Confirms no row has an empty Status cell
  Failure blocks merge with a clear error pointing at the template.
- `.vercel/agent.md` widened with three categories from real Vercel
  Agent catches: constant-condition filter/map callbacks (#153),
  Drizzle index parity gaps (#150), admin-only auth gate missing
  on server components (#150). Future dry-runs check these too.

**Why this is the structural fix:**
- Previous attempts ("I'll do the dry-run next time") were verbal
  commitments without a forcing function. The pattern repeated.
- This gate makes the dry-run a hard prerequisite: no filled-in
  section, no merge. Same mechanism that makes backlog hygiene
  actually work.

**Acceptance:** ✅ The next PR opened against `main` shows the
pre-push self-review section pre-populated; pushing without filling
it in fails the gate.

**Operator follow-up:** add `Pre-push self-review section` to
required status checks in Settings → Branches → main.

---

### BL-QC-guidelines — Engineering standards + agent guidelines docs — **shipped**
**Priority:** P1  ·  **Effort:** S  ·  **Depends on:** BL-QC  ·  **Status:** ✅ shipped

Surfaced when the stuck Vercel Agent task on PR #150 reported "No
guidelines found" — every project-level standard we'd built up
existed only as enforcement code (CI gates, CODEOWNERS, isolation
script), with no human- or bot-readable document to point at. Closed
that gap.

**Shipped:**
- `docs/ENGINEERING_STANDARDS.md` — canonical standards doc. 9
  sections: multi-tenant isolation contract, audit logging, schema
  + migration discipline, server action conventions, file
  organization, PR conventions, the pre-merge gate stack, CODEOWNERS
  routing, code review etiquette. Examples + anti-patterns for the
  critical surfaces.
- `AGENTS.md` (repo root) — bot-facing pointer in the conventional
  location AI coding tools look. Quick orientation + "what to flag /
  what NOT to flag" + authoring conventions list.
- `.vercel/agent.md` — Vercel-Agent-specific subset. Tells the agent
  what to focus on (categories no other gate catches) and what to
  skip (categories already enforced by gates) so reviews stop being
  redundant with existing checks. Should resolve future "No
  guidelines found" reports.

**Acceptance:** ✅ Next Vercel Agent Review on a FORGE PR finds the
guidelines file. Future AI tools (Claude, Cursor, etc.) have a
single rooted source of truth.

---

### BL-20 — Authorization decision logging — **shipped**
**Priority:** P2  ·  **Effort:** S  ·  **Depends on:** BL-12  ·  **Status:** ✅ shipped

Authz denials in the `require*` helpers now write an `auth_denied`
audit row so ops can spot probing / stuck users.

**Shipped:**
- ✅ `recordAuthDenied()` helper in `src/lib/audit-log.ts` — same
  shape as `recordAudit`, takes a `reason` of
  `not_member` | `not_org_admin` | `not_superadmin`, persists with
  `action="auth_denied"`, `resourceType="auth"`, `resourceId=<reason>`
- ✅ Wired into `requireOrgMember`, `requireOrgAdmin` (both deny
  paths), `requireSuperadmin` before each redirect
- ✅ Unauthenticated denials are skipped (no tenant context to
  attribute the row to — those surface in HTTP logs instead)
- ✅ "Authorization (denied)" resource preset added to both the
  per-tenant `/audit-log` viewer and the BL-18 platform viewer so
  ops can filter directly to denials

**Acceptance:** ✅ A non-superadmin hitting `/platform/audit-log`
(or `/admin/*`) is redirected and an `auth_denied` /
`reason=not_superadmin` row appears in the audit log. Same for
non-admin hitting org-admin actions, and non-member hitting another
tenant's surface.

---

### BL-21 — Help content refresh
**Priority:** P3  ·  **Effort:** S  ·  **Depends on:** —  ·  **Status:** rolling

PR #98 added FAQ. User Guide (`/help/user`) and Admin Guide
(`/help/admin`) markdown is updated as features ship.

**Scope:** rolling — each shipping BL adds a section to user/admin
guide. Tracked as continuous work, not a single PR.

**Completed passes:**
- ✅ Audit log family (BL-12 / BL-12c / BL-18 / BL-20) — USER_MANUAL
  §8 rewritten: new §8.12 documents `/audit-log` (filters + CSV
  export + retention + read-vs-mutation chip). Stale §8.11 bullets
  removed ("no unified feed", "no IP/UA capture" — both wrong now).
  ADMIN_MANUAL §4.5 trimmed of the same stale bullets; new §4.6
  documents `/audit-log` + `/platform/audit-log` + `auth_denied` +
  retention; new §4.7 cross-references the feature-level trails.
- ✅ Stage widgets + cross-page sync (BL-3 / BL-7) — USER_MANUAL §5.1
  rewritten to describe the 10-widget grid (count + value range +
  due hint + past-due badge + click-to-filter); USER_MANUAL §2
  gains a "Command Center vs. Opportunities Dashboard" §2.1 that
  spells out the navigate-vs-filter split and the shared snapshot.
- ✅ Multi-tenant isolation (BL-19 Phase 1) — ADMIN_MANUAL §5.4
  rewritten as "three layers" (route gates / query scope / audit
  denials) with the static-check CI gate called out by name and the
  Phase 2 runtime-test plan referenced.
- ✅ BL-13 Notification rules engine + BL-15 Phase A per-tenant
  detail page — ADMIN_MANUAL gains §3.4 (per-tenant detail page in
  the SuperAdmin portal) and a new §5 "Notification rules"
  (anatomy, default seed rules, test send, operating practices);
  troubleshooting renumbered to §6. USER_MANUAL gains §9
  "Notifications inbox" (where to find notifications, what kinds
  appear, frequency/digest semantics, test-send convention);
  sign-out renumbered to §10.
- ✅ BL-8 Proposals submenu split — USER_MANUAL §6 intro updated
  to describe the two nav entries (In-flight Proposals / New
  Proposals) under Opportunities; §2 sidebar enumeration calls out
  the Opportunities-group children; §6.1 tab list documents the
  Submitted → "Past proposals" rename and clarifies the Submitted
  stat tile vs. Past-proposals tab distinction; §6.2 mentions the
  New Proposals nav entry as an alternative entry point.
- ✅ BL-16 Subscription tiers + quotas (Phases A through C-3) —
  ADMIN_MANUAL gains a new §6 "Subscription tiers and quotas":
  §6.1 default tiers (Bronze through Custom with prices + features
  + quotas), §6.2 what each feature flag gates, §6.3 how quotas
  work (counter-backed vs live-measured + the 0 = unlimited
  convention + the failed-attempts-still-count tradeoff), §6.4
  editing tier definitions, §6.5 moving a tenant to a different
  tier, §6.6 per-tenant overrides (custom_overrides JSONB), §6.7
  safe retirement, §6.8 operating practices. Troubleshooting
  renumbered to §7 (subsections 6.1–6.8 → 7.1–7.8).
- ✅ BL-16 Phase C-4 promo codes + BL-15 Phase B-2 transfer
  ownership — ADMIN_MANUAL §3.4 mentions the new Primary admin
  field on the per-tenant detail page + tier dropdown; new §3.5
  documents the transfer-ownership flow with `tenant.transfer_ownership`
  audit. ADMIN_MANUAL §6.8 added: promo code CRUD walkthrough
  (status pills, code constraints, redemption deferral to BL-17).
  §6.9 operating practices gets a fourth bullet on promo-code
  hygiene (set valid_until + max_uses on launch codes).
- ✅ BL-15 Phase B-1 tenant data export — ADMIN_MANUAL gains §3.6
  "Exporting tenant data" documenting the **Export data ↓** button
  on the per-tenant detail page header. Spells out what's included
  (org identity + members + opportunities + proposals + knowledge
  artifacts + notification rules — all metadata, no large blobs),
  what's deliberately excluded (proposal bodies, review comments,
  knowledge raw_text, audit log rows), the JSON-file name format,
  and the `tenant.data_export` recordRead audit. Notes the async
  "full snapshot" pattern as future work.
- ✅ BL-10 Knowledge base (Phases A through D) — USER_MANUAL gains
  a new §8 "Knowledge base" (renumbering audit-trail to §9,
  notifications inbox to §10, signing out to §11). Covers:
  §8.1 corpus uploads + AI auto-detect classification + backfill;
  §8.2 group-by-kind toggle; §8.3 row-level actions
  (Open / Archive / Delete); §8.4 curated knowledge entries by
  kind; §8.5 quality score panel with tone-coding + factor
  breakdown + admin Score-unscored backfill; §8.6 tips for
  getting the most out of the corpus. Internal §8.12 cross-ref
  updated to §9.12.
- ✅ BL-22 Nav v2 polish — USER_MANUAL §2 layout bullet rewritten
  to call out the collapsible icon-rail (wide ↔ icons), tree-
  connector lines under sub-items, and the user identity card at
  the bottom of the sidebar (replaced the older FORGE Brain
  promo). New §2.1 "Sidebar navigation" enumerates every group +
  its children (with role visibility) and explains the
  collapse-to-icons toggle. Existing CC-vs-Dashboard subsection
  renumbered to §2.2.

**Still outstanding (queued for future passes):**
- (none — BL-21 outstanding queue is drained as of this pass)

---

### BL-22 — Nav v2 — collapsible icon rail + visual refresh
**Priority:** P1  ·  **Effort:** M  ·  **Status:** ✅ Merged #103

Sourced from a design reference shared by the user. Brings the nav
in line with modern SaaS patterns: a collapsible icon rail, clearer
expand/collapse affordance on groups, tree-connector lines under
sub-items, and a user identity card pinned at the bottom replacing
the FORGE Brain promo.

---

### BL-23 — AI document review + Capability Matrix + Question Generator — **shipped (primary surface)**
**Priority:** P1  ·  **Effort:** L  ·  **Status:** ✅ Primary surface delivered. Opportunity-mirror surface tracked as **BL-23b**.

When a user uploads RFP / RFI / Sources Sought / RFQ documents to a
solicitation, FORGE should provide an AI-driven review pipeline with
three actions surfaced as a button group on the solicitation detail
page (and visible on the linked opportunity if one exists):

1. **Initiate Review** — kicks off a deep AI read of every uploaded
   attachment. Extracts structured requirements (Section L
   instructions + Section M evaluation factors), capability
   areas needed, evaluation weights, period of performance, place
   of performance, mandatory certifications, set-aside details, and
   anything else the model can pin down. Persists the result so the
   review can be re-opened without re-running.

2. **Create Capability Matrix** *(disabled until review completes)* —
   takes the review output and joins it against the org's Knowledge
   entries (capabilities + past performance from `/knowledge-base`).
   Produces a matrix: each requirement on one axis, each candidate
   capability/past-perf on the other, with cell-level scoring (Strong
   / Partial / Gap / Not addressed) plus citations to the knowledge
   entries that support each cell. Output drives a recommended PWIN
   contribution: how confident the org should feel about responding
   to each requirement based on its real evidence base.

3. **Generate Questions** *(disabled until review completes)* —
   takes the review output and produces a comprehensive list of
   clarification questions the team should ask the contracting
   office. Categorized: scope ambiguity, evaluation criteria,
   submission logistics, technical constraints, security/clearance,
   subcontracting / set-aside applicability. Each question cites the
   document section that prompted it. Exportable as plain text or
   Word for the team to send back to the CO.

**Why this matters:** Current solicitation extraction (the prompt
in `solicitation-extract.ts`) returns a thin summary — title, due
date, NAICS, a short list of requirements. The user is asking for a
deeper, decision-grade analysis tied directly to PWIN scoring and
question-asking workflows that capture managers run today by hand.

**Where it lives in the UI:**
- Primary surface: solicitation detail page
  (`/solicitations/[id]`) — three-button header right after the file
  metadata, plus dedicated panels for the review output, capability
  matrix, and question list once they exist
- Mirror surface: opportunity detail page (when a solicitation is
  linked to an opportunity) — same three-button group, same three
  panels, scoped to all attached solicitation documents

**Schema:**
- `solicitation_review` (id, organization_id, solicitation_id,
  status [pending / running / complete / failed], result jsonb
  [extracted requirements, capability buckets, evaluation factors,
  open questions surfaced during review], model, stubbed, created_by,
  created_at, completed_at)
- `solicitation_capability_matrix` (id, organization_id,
  solicitation_review_id, cells jsonb [{ requirementId, capabilityRef,
  status, citation, narrative }], pwin_recommendation_low,
  pwin_recommendation_high, model, stubbed, created_at)
- `solicitation_question_set` (id, organization_id,
  solicitation_review_id, questions jsonb [{ category, text,
  rationale, sectionRef }], model, stubbed, created_at)

**Server actions:**
- `runSolicitationReviewAction(solicitationId)` — full doc read +
  extraction. Rate-limited (5/hour per solicitation). Sets
  `solicitation_review.status` to running, then complete on finish.
  Idempotent — re-running UPSERTs.
- `runCapabilityMatrixAction(solicitationId)` — requires a complete
  review. Pulls Knowledge entries, runs scoring prompt. UPSERT.
- `runQuestionGeneratorAction(solicitationId)` — requires a complete
  review. UPSERT.
- `getReviewStatusAction(solicitationId)` — returns the trio of
  states for the UI to enable/disable the buttons.

**Client UX:**
- "Initiate Review" → shows progress (uses existing notification or
  a dedicated panel state). Re-enables once complete.
- "Create Capability Matrix" + "Generate Questions" disabled with
  tooltip "Run document review first" until status === complete.
- Each output panel is collapsible; matrix supports cell drill-in
  to view the citing Knowledge entry; question list supports export.

**Acceptance:**
- Upload an RFP PDF, click Initiate Review, see progress, then a
  populated review panel with extracted requirements + evaluation
  factors visible
- Other two buttons are disabled before review, enabled after
- Capability Matrix renders a real matrix (rows × columns) with
  cell statuses citing actual Knowledge entries
- Question Generator returns categorized questions citing source
  document sections
- All three outputs persist — reload the page, they're still there

**Effort breakdown:**
- Schema + migration: 0.5 day
- Server actions + AI prompts (3 prompts): 2 days
- UI: button group, three result panels, status polling: 2 days
- Knowledge join logic for capability matrix: 1 day
- Stub-mode handling + tests: 0.5 day
- Total: ~6 days (1 week)

**Delivered files:**
- `drizzle/0033_solicitation_review_matrix_questions.sql`
- `src/db/schema.ts` — three new tables (`solicitationReviews`,
  `solicitationCapabilityMatrices`, `solicitationQuestionSets`),
  `solicitationReviewStatusEnum`, four new types
- `src/lib/ai-prompts-bl23.ts` — three prompts + zod schemas
- `src/lib/ai-prompts.ts` — re-exports BL-23 prompts
- `src/lib/solicitation-ai-review.ts` — three AI runners with stub-mode
  payloads
- `src/app/(app)/solicitations/[id]/review-actions.ts` — server
  actions: `runSolicitationReviewAction`, `runCapabilityMatrixAction`,
  `runQuestionGeneratorAction`, `getReviewStatusAction`
- `src/app/(app)/solicitations/[id]/SolicitationReviewPanel.tsx` —
  client orchestrator with three-button group + collapsible result
  sections (review output, capability matrix, question list)
- `src/app/(app)/solicitations/[id]/page.tsx` — load review state +
  embed panel above existing layout

---

### BL-23b — AI doc review: opportunity-mirror surface — **shipped**
**Priority:** P2  ·  **Effort:** M  ·  **Depends on:** BL-23  ·  **Status:** ✅ shipped

Mirror of BL-23's three-button workflow (Initiate Review / Build
Matrix / Generate Questions) on the opportunity detail page,
scoped to every solicitation linked to the opportunity.

**Shipped:**

- New `OpportunityDocsAndAIPanel` (server component) at
  `src/app/(app)/opportunities/[id]/OpportunityDocsAndAIPanel.tsx`:
  - Queries every solicitation with `opportunity_id = X` for this
    org, then loads review / matrix / questions state in parallel
  - Empty state when no solicitation is linked (with "Upload a
    solicitation →" CTA)
  - Aggregate counts in the panel header when 2+ solicitations
    ("N/M reviews · K matrices · J question sets")
- New `OpportunityDocsAndAIClient` (client component) at
  `src/app/(app)/opportunities/[id]/OpportunityDocsAndAIClient.tsx`:
  - Per-solicitation row with title (link to /solicitations/[id])
    + solicitation number + stub-mode marker
  - Status pills: review (Not started / Pending / Running /
    Reviewed / Failed) + matrix cell count + question count
  - Three compact action buttons (Initiate review / Build matrix /
    Generate questions). Downstream buttons disabled until review
    completes (same gating as the primary surface)
  - "Full results →" link to the solicitation detail page
  - Re-uses the same `runSolicitationReviewAction`,
    `runCapabilityMatrixAction`, `runQuestionGeneratorAction`
    server actions as the primary surface (single source of
    truth — no duplicated business logic)
- Wired into `src/app/(app)/opportunities/[id]/page.tsx` below
  `OpportunityBriefPanel` in the right column

**Design decision: rolled-up rows instead of inline-full-panel for
the 1-solicitation case.** The original spec asked for the full
panel inline when exactly 1 solicitation is linked. The full
`SolicitationReviewPanel` is ~700 LOC of result rendering. Mirroring
it on the opportunity page would either duplicate that code or make
the opportunity page heavy. The rolled-up row + "Full results →"
link preserves the operator's primary need (run actions without
leaving the opp page) at much lower cost. The full panel stays on
the solicitation detail page where it's clicked through.

**Acceptance:** ✅ open an opportunity with linked solicitations →
see review status for each → can run any of the three actions
without leaving the opportunity page → click-through to the full
solicitation panel for detailed results.

---



---

## Effort summary

| Category | Items | Total effort |
|---|---|---|
| Cleanup / debt | BL-1, BL-2 (shipped) | ~1 day |
| Capture & pursuit | BL-3, BL-4, BL-5, BL-6, BL-7 | ~10 days |
| Proposal operations | BL-8, BL-9 (XL), BL-23 | 4-6 weeks + 1.5 weeks |
| Platform intelligence | BL-10, BL-11 | ~2 weeks |
| Operations Management | BL-12, BL-13, BL-14 | ~2.5 weeks |
| Platform Administration | BL-15, BL-16, BL-17, BL-18 | ~5 weeks |
| UX | BL-22 (shipped) | ~2 days |
| Foundation | BL-19, BL-20, BL-21 | ~2 days + ongoing |
| **Total** | **23 backlog items** | **~12–14 weeks** |

## Recommended execution order

Strict P0 / P1 / P2 ordering, with parallelism where dependencies allow:

1. ~~**BL-1, BL-2**~~ — placeholder debt closed (PR #102)
2. ~~**BL-22**~~ — nav v2 visual refresh (PR #103)
3. **BL-3** — small, ships visible polish (stage widgets) ← **next**
4. **BL-7** — tied to BL-3; wire the same widgets to Command Center
5. **BL-4** — pipeline funnel (visible win)
6. **BL-5** — GSA paste (mirrors existing eBuy paste; well-trodden)
7. **BL-6** — Add Source extensibility
8. **BL-23** — AI document review + Capability Matrix + Question Generator
   *(could move earlier — high user value; depends partly on BL-10 for capability join data)*
9. **BL-12** — Tenant Audit Log (P0; foundation for BL-15, BL-18, BL-20)
10. **BL-19** — isolation test suite (P0; can ship in parallel with BL-12)
11. **BL-13** — Notifications rules engine
12. **BL-14** — Settings route split
13. **BL-8** — In-flight/New menu finalization
14. **BL-10** — Knowledge ingestion improvements (unblocks BL-23 capability matrix data quality)
15. **BL-15** — Tenant Administration
16. **BL-16** — Platform Configuration / tier model
17. **BL-17** — Subscriptions module
18. **BL-18** — Platform Audit Log
19. **BL-20** — Auth decision logging
20. **BL-11** — Brain self-improvement loop
21. **BL-9 (XL)** — Word-level collab editor (the big one)
19. **BL-21** — Help content refresh (continuous)

This document is the single source of truth for backlog items.
Update it in the same PR that ships an item — mark status, link the
PR number, note any scope changes.
