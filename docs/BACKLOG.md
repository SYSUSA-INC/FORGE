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

### BL-3 — Stage spell-out widgets on Opportunities Dashboard
**Priority:** P1  ·  **Effort:** S  ·  **Depends on:** —

Per spec: convert the S1, S2, S3, S4, S5, S6, S7, W, L, NB chips on
`/opportunities` into actual widgets that show the data per stage,
with stages spelled out ("S1 → Stage 1", etc.). Keep the existing
filter behavior, but the widgets become first-class tiles with
counts + value totals + due-date proximity hints.

**Scope:**
- Server-side aggregate: count, total value (low/high), nearest due
  date per stage
- Client widget grid: 7 active stages + W (Won) + L (Lost) + NB
  (No-bid) in stage order
- Each widget: stage label, count, value range, "due within N days"
  badge, click-to-filter
- Replace existing chip row; tile stays selected on click

**Acceptance:** dashboard renders 10 widgets; clicking one filters
the list below; counts match `select count(*) from opportunities
group by stage` per the org.

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

### BL-7 — Cross-page data sync (Command Center ↔ Opportunities Dashboard)
**Priority:** P1  ·  **Effort:** M  ·  **Depends on:** BL-3

Per spec: "All this information MUST roll up to the command center
dashboard and to the Opportunities dashboard. The data has to sync
across."

**Scope:**
- Audit current `/` (Command Center) page; identify which widgets
  show stale data vs. live aggregates
- Build a single server-side `getOrganizationSnapshot()` function
  that returns the aggregate model used by both pages
- Wire `revalidatePath('/')` on opportunity mutations
- Add the same stage-widget tiles to Command Center (read-only, with
  a "Open Opportunities Dashboard →" link)

**Acceptance:** create an opportunity → Command Center stage count
updates on next nav (no manual refresh required); same number on
both pages.

---

## Proposal operations

### BL-8 — In-flight / New Proposals submenu finalization
**Priority:** P1  ·  **Effort:** S  ·  **Depends on:** PR #100

PR #97 added the In-flight / Submitted tabs on `/proposals`. PR #100
adds the launcher at `/proposals/new`. Per spec, the menu shows
"In-flight Proposals" and "New Proposals" as the two Proposals
sub-items.

**Scope:**
- Replace single "Proposals" nav item under Opportunities with a
  parent "Proposals" header + two children:
  - In-flight Proposals → `/proposals` (already lands on In-flight tab)
  - New Proposals → `/proposals/new` (launcher)
- Renames "Submitted" tab on `/proposals` to "Past proposals" (the
  spec doesn't mention Submitted; this matches the "In-flight" /
  "Past" mental model better)

**Acceptance:** menu shows the two sub-items; clicking each lands on
the right page with the right state.

---

### BL-9 — Word-level collaborative editor with track changes
**Priority:** P1  ·  **Effort:** XL (4-6 weeks)  ·  **Depends on:** —

Per spec: full Word-comparable editor; multi-user real-time collab;
track changes; merge on document-owner consensus; uses company
templates. Section editing happens inside FORGE so the Brain learns
from edits.

**Scope (phased — break into BL-9a … BL-9f):**

- **BL-9a** Foundation: Yjs CRDT integration with the existing
  TipTap editor; per-section Yjs doc; `y-websocket` provider with
  authentication; presence cursors + names
- **BL-9b** Track changes: tracked-changes mark layer (insertions,
  deletions, format changes); accept/reject UI per change; per-user
  attribution
- **BL-9c** Comment threads: anchored to a text range; reply chain;
  resolve/unresolve; per-comment notification
- **BL-9d** Suggestion mode: switch from "edit" to "suggest" — all
  changes become tracked-changes by default, owner approves before
  they apply to the canonical doc
- **BL-9e** Diff visualization: side-by-side or inline diff between
  two snapshots; restore prior snapshot
- **BL-9f** Brain feedback: every accepted/rejected change feeds the
  pattern-intel pipeline so future drafts learn from real edits

**Acceptance per phase:** measured against the existing TipTap editor
+ team workflow; specifics defined per sub-BL when each starts.

---

## Platform intelligence (Brain & Knowledge)

### BL-10 — Knowledge ingestion improvements
**Priority:** P2  ·  **Effort:** M  ·  **Depends on:** —

Per spec: "Knowledge — critical area where a company can dump all its
historical data... The data provided here will be leveraged by the
FORGE Brain..."

Today's `/knowledge-base` supports artifact upload + manual entries.
Improvements:

**Scope:**
- Bulk upload (drag-drop multiple files, queue-and-process)
- Auto-categorization on ingest (capability / past-performance /
  personnel / boilerplate) using the existing extraction prompt
- Folder/category tree view
- Entry quality scoring (how confident the Brain is in this entry)

**Acceptance:** drop 20 files at once → all index successfully →
auto-categorized with reviewable suggestions → quality scores show.

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
**Priority:** P0  ·  **Effort:** L  ·  **Depends on:** —

Per spec: "notifications can be configured, who receives them, their
frequency, and whether there is an SLA for escalations. These should
all be configurable."

**Scope:**
- Schema: `notification_rule` (id, org_id, name, trigger_event_kind,
  match_filter jsonb, recipient_strategy, channels[], frequency,
  sla_seconds, escalation_strategy, active)
- Schema: `notification_delivery` (id, rule_id, recipient_user_id,
  channel, sent_at, acked_at, sla_breached_at)
- Trigger event kinds: opportunity_due_soon, proposal_section_overdue,
  review_request_pending, audit_anomaly, etc.
- Recipient strategies: specific users, role-based (PM, captureMgr,
  pricingLead), formula (the proposal owner)
- Channels: in-app (existing notifications table), email, future
  Slack/Teams
- Frequency: immediate, batched daily, batched weekly
- SLA escalations: if not acknowledged in N seconds, notify a
  fallback recipient
- UI on `/notifications/rules`: list + edit + test; "test send" sends
  a sample notification to verify delivery
- Migrate existing hardcoded notification triggers to use the new
  engine

**Acceptance:** create a rule "notify pricing-lead 48h before due
date"; opportunity advances within 48h; rule fires; notification
delivered; SLA breach escalates to PM if not acknowledged.

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
**Priority:** P0  ·  **Effort:** L  ·  **Depends on:** BL-12 (uses audit log)

Per spec: "this is where the customer accounts are managed."

**Scope:**
- Provision new tenant (creates organization, primary admin user,
  invitation email; assigns default tier)
- Suspend tenant (sets `organizations.status`; users see suspension
  notice on next request; new sessions blocked)
- Restore tenant (reverses suspension)
- Transfer ownership (change `primary_admin_user_id`)
- Per-tenant data summary: users, opportunities, proposals, storage
  usage, AI request counts (last 30d)
- "Assume identity" flow for support: superadmin can read-only-view a
  tenant's UI for debugging; every action logged in BL-12
- Data export for offboarding
- Audit isolation status check (a button that runs sample
  cross-tenant queries to verify isolation)

**Acceptance:** provision a new tenant via UI → tenant admin gets
invite email → can sign in → sees only their data; suspend tenant →
their users blocked from sign-in; assume-identity logs to audit log.

---

### BL-16 — Platform Configuration (tier model)
**Priority:** P1  ·  **Effort:** L  ·  **Depends on:** BL-15

Per spec: "tailor offerings with promotions and various levels:
Bronze, Silver, Gold, Platinum, Custom."

**Scope:**
- Schema: `subscription_tier` (id, name, description, price_monthly,
  price_yearly, feature_flags jsonb, quotas jsonb, sort_order, active)
- Schema: `tenant_subscription` (organization_id PK, tier_id,
  status, current_period_start, current_period_end, trial_until,
  cancel_at, custom_overrides jsonb)
- Default tiers seeded: Bronze, Silver, Gold, Platinum, Custom
- Feature flags per tier: e.g. `aiAutoDraft`, `winnerAnalysis`,
  `complianceMatrix`, `bulkExport`, `apiAccess`, `customTemplates`
- Quotas per tier: `aiRequestsPerMonth`, `seatsIncluded`,
  `storageGb`, `proposalsPerMonth`
- Runtime gates: `ensureFeature(orgId, "winnerAnalysis")` called
  before each gated action; throws GatedError if denied
- Promotional codes: `promotion_code` (code, discount_percent,
  valid_until, max_uses)
- UI for super-admin to define tiers, promotions, view assignments

**Acceptance:** create Custom tier with `aiRequestsPerMonth=0` →
assign to test tenant → tenant cannot run any AI feature → upgrade
to Gold → AI features work.

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

### BL-18 — Platform Audit Log (cross-tenant)
**Priority:** P1  ·  **Effort:** S  ·  **Depends on:** BL-12

Per spec: "full platform audit logs that can be filtered by tenant,
type, and time."

**Scope:**
- Reuses BL-12 schema (no new table)
- Super-admin query API + UI on `/platform/audit-log`
- Filters: tenant, actor, action, resource type, time window
- "Group by tenant" view for anomaly detection
- CSV export with proper escaping

**Acceptance:** every BL-12 row visible to super-admin regardless of
tenant; filtering works; small (~5 min latency) is fine.

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

### BL-20 — Authorization decision logging
**Priority:** P2  ·  **Effort:** S  ·  **Depends on:** BL-12

Every `requireAuth`, `requireCurrentOrg`, `requireSuperadmin`, and
feature-gate decision should land in the audit log if denied —
gives ops a tool to detect probing or stuck users.

**Scope:**
- Wrap auth helpers to record denials with reason code
- "Auth denied" filter in the audit log UI

**Acceptance:** unauthorized request to `/platform/tenants` shows up
in BL-12 with action=`auth_denied`, reason=`not_superadmin`.

---

### BL-21 — Help content refresh
**Priority:** P3  ·  **Effort:** S  ·  **Depends on:** —

PR #98 added FAQ. User Guide (`/help/user`) and Admin Guide
(`/help/admin`) markdown should be updated to reflect the new nav,
new launcher flow, audit log, notifications rules, etc. as each
feature ships. Tracked here so it doesn't fall behind.

**Scope:** rolling — each shipping BL adds a section to user/admin
guide. Tracked as continuous work, not a single PR.

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

### BL-23b — AI doc review: opportunity-mirror surface
**Priority:** P2  ·  **Effort:** M  ·  **Depends on:** BL-23

The original BL-23 spec asks for a mirror of the three-button workflow
on the opportunity detail page when a solicitation is linked. BL-23
shipped the primary surface (solicitation detail). This follow-up
adds the mirror, scoped to all solicitations attached to the opp.

**Scope:**
- New panel on `/opportunities/[id]` titled "Documents & AI review"
- Lists every solicitation attached to this opportunity with status
  indicators (review done / matrix done / questions done)
- For each, a compact three-button cluster mirroring BL-23 + a
  click-through to the full solicitation detail page for the panel
- When the opp has exactly one linked solicitation, render the full
  panel inline (no aggregation needed)
- When the opp has 2+ solicitations, aggregate counts in a header
  ("3 reviews complete · 2 matrices · 1 question set") + per-doc rows

**Acceptance:** open an opportunity with linked solicitations →
see review status for each → can run any of the three actions
without leaving the opportunity page → outputs match what shows on
the solicitation detail page.

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
