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

### BL-4 — Pipeline funnel diagram
**Priority:** P1  ·  **Effort:** M  ·  **Depends on:** —

Per spec: `/pipeline` shows a sales-funnel visualization. Today the
page exists but is a list. Replace with a real funnel.

**Scope:**
- Funnel shape: stacked horizontal bars (or trapezoidal funnel) with
  stage label + count on each segment
- Conversion-rate annotations between stages (% that advanced)
- Drill-in: click a segment → opens the existing list filtered to
  that stage
- Time window selector (last 30 / 90 / 365 days, all time)
- Optional toggle: count vs. weighted value (count × PWin × midpoint
  of value range)

**Acceptance:** funnel renders with non-zero data on a real org;
conversion rates compute correctly; clicking a segment scrolls to or
filters the list below.

---

### BL-5 — GSA email paste (Solicitations)
**Priority:** P1  ·  **Effort:** M  ·  **Depends on:** —

Mirror of the existing eBuy paste flow, for GSA Schedule notification
emails. User pastes the forwarded GSA email; AI extracts the
opportunity fields; user reviews + creates the opportunity.

**Scope:**
- New route `/solicitations/import/gsa` (or under /opportunities/import)
- Reuse the eBuy AI prompt scaffolding; new prompt tailored to GSA
  Schedule notification email format
- Attachment upload (the user said "and add attachments")
- Same review-then-create UX as eBuy paste
- Wire under Operations Management and Solicitations menu

**Acceptance:** paste a real GSA Schedule notification email →
extracted fields populate → user creates an opportunity → opp
appears on dashboard with attachments linked.

---

### BL-6 — "Add Source" extensibility
**Priority:** P1  ·  **Effort:** M  ·  **Depends on:** BL-5

Per spec: customers can suggest additional opportunity-import sources.
Suggestions roll up so the platform team learns what to build next.

**Scope:**
- New schema: `opportunity_source_request` (id, org_id, requester_user_id,
  source_name, description, sample_text, status, votes, created_at)
- UI form on `/solicitations/import` titled "Don't see your source?"
- Optional sample paste so we can prototype
- Per-tenant view of own requests + status (pending / under review /
  shipped)
- Super-admin view (cross-tenant) under Platform Administration to
  triage requests, dedupe, prioritize

**Acceptance:** customer submits a source request → admin sees it in
Platform Administration → marks it "under review" → customer sees
status update in their tenant view.

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

### BL-12 — Tenant-scoped Audit Log
**Priority:** P0  ·  **Effort:** L  ·  **Depends on:** —

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

### BL-14 — Settings page route split
**Priority:** P2  ·  **Effort:** S  ·  **Depends on:** —

PR #99 deep-links Settings tabs via `?tab=integrations`. The spec
asks them to be separate menu items; they're treated as such, but
under the hood they're all `/settings`. Refactor to real routes so
each has its own URL.

**Scope:**
- `/settings/users` → reads UsersRolesTab content (or merge with
  `/users` which already exists — pick the cleaner option)
- `/settings/integrations` → IntegrationsTab content
- `/settings/ai-engine` → AIEngineTab content
- `/settings` → just OrganizationTab (the "real" Settings)
- Remove `?tab=` deep-link logic from SettingsClient
- Update nav links

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
**Priority:** P0  ·  **Effort:** S  ·  **Depends on:** —

PR-1 closed every cross-tenant UPDATE/DELETE leak found in the
audit. To prevent regression, ship an automated test suite that
verifies isolation:

**Scope:**
- Test harness: provisions 2 tenants with seed data
- For every table that has `organization_id`, asserts:
  - Tenant A cannot SELECT tenant B's rows via any server action
  - Tenant A cannot UPDATE tenant B's rows
  - Tenant A cannot DELETE tenant B's rows
  - Tenant A cannot reference tenant B's foreign keys (e.g. assign a
    proposal to an opportunity in another tenant)
- Run on every PR via CI gate
- Snapshot of acceptable cross-tenant interactions (none today; if
  any added later they must be explicitly allow-listed)

**Acceptance:** CI fails if any new server action lacks the
isolation assertion; existing pass.

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

## Effort summary

| Category | Items | Total effort |
|---|---|---|
| Cleanup / debt | BL-1, BL-2 | ~1 day |
| Capture & pursuit | BL-3, BL-4, BL-5, BL-6, BL-7 | ~10 days |
| Proposal operations | BL-8, BL-9 (XL) | 4-6 weeks + 1 day |
| Platform intelligence | BL-10, BL-11 | ~2 weeks |
| Operations Management | BL-12, BL-13, BL-14 | ~2.5 weeks |
| Platform Administration | BL-15, BL-16, BL-17, BL-18 | ~5 weeks |
| Foundation | BL-19, BL-20, BL-21 | ~2 days + ongoing |
| **Total** | **21 backlog items** | **~10–12 weeks** |

## Recommended execution order

Strict P0 / P1 / P2 ordering, with parallelism where dependencies allow:

1. **BL-1, BL-2** — close the placeholder debt before starting anything new
2. **BL-3** — small, ships visible polish (stage widgets)
3. **BL-7** — tied to BL-3; wire the same widgets to Command Center
4. **BL-4** — pipeline funnel (visible win)
5. **BL-5** — GSA paste (mirrors existing eBuy paste; well-trodden)
6. **BL-6** — Add Source extensibility
7. **BL-12** — Tenant Audit Log (P0; foundation for BL-15, BL-18, BL-20)
8. **BL-19** — isolation test suite (P0; can ship in parallel with BL-12)
9. **BL-13** — Notifications rules engine
10. **BL-14** — Settings route split
11. **BL-8** — In-flight/New menu finalization
12. **BL-15** — Tenant Administration
13. **BL-16** — Platform Configuration / tier model
14. **BL-17** — Subscriptions module
15. **BL-18** — Platform Audit Log
16. **BL-20** — Auth decision logging
17. **BL-10, BL-11** — Brain & Knowledge improvements
18. **BL-9 (XL)** — Word-level collab editor (the big one)
19. **BL-21** — Help content refresh (continuous)

This document is the single source of truth for backlog items.
Update it in the same PR that ships an item — mark status, link the
PR number, note any scope changes.
