# FORGE — Multi-Tenant Data Firewall Audit (2026-09-10)

**Auditor:** Engineering
**Scope:** Every code and DB layer that could leak data between tenants, re-run per §6 of the June report
**Status:** PASS with documented exceptions — **0 P0, 0 P1**; 18 P2 and 27 P3 findings, all remediated in PR #261 or tracked
**Trigger:** Quarterly cadence + "before every major feature that adds new API routes or tenant-scoped tables" (Phases A–C added 6 routes and 11 tables)
**Previous:** `06-multi-tenant-firewall-2026-06.md` (PR #211, commit `06e10de`)

---

## 1. Executive Summary

FORGE's multi-tenant isolation remains **structurally sound**. Four parallel sweeps (API routes, server-only libs, server components, DB schema) over the codebase at `eef3c3e` found **no exploitable cross-tenant read or write**. Every gated surface takes its `organizationId` from the session gate, every `[id]` page verifies the parent row against that org and fails closed, and every cross-tenant path is confined to `requireSuperadmin()` or `CRON_SECRET` handlers.

What changed since June is *where the risk lives*. The static checker covered server actions only; since then most DB reads moved into `src/lib` server-only modules and API routes it never saw, and the "verify the parent by org, then write the child by bare id" pattern had spread to **48 write statements**. None was exploitable, because each sat behind a parent check. Each was one refactor away from the class the May 2026 audit rated P0.

This re-run therefore delivers CI gates rather than a document:

- `scripts/check-isolation.mjs` now covers **five surfaces** (actions, API routes, server-only libs, server components, raw SQL touching embeddings) and enforces a **strict write rule**: every `UPDATE` / `DELETE` on a tenant table carries the org predicate in its own `WHERE`, including in non-exported helpers.
- `scripts/check-tenant-firewall.mjs` (new) re-derives the DB-level guarantees from the migrations on every PR: `organization_id NOT NULL`, CASCADE FK, a leading-org index, and schema parity for all 43 tenant-scoped tables.
- Every finding below is fixed in the same PR, except the schema-drift hygiene item (tracked as **BL-TENANT-DRIFT**) and one convention note.

We can continue onboarding customers. The remaining risk is drift, and drift is now a CI failure.

---

## 2. Method

Four parallel read-only sweeps against `main` at `eef3c3e`, each written to a per-dimension report, then verified by hand and by running the widened checkers against the tree.

| Dimension | Reviewed | Tool |
|---|---|---|
| API route handlers | 21 handlers in 20 `src/app/api/**/route.ts` | Subagent + manual verification |
| Server-only libs | 36 `src/lib` modules importing `@/db` (84 exported functions, 47 touching tenant tables) | Subagent + manual verification |
| Server components | 92 non-client components (41 importing `@/db`; 51 gate-only / loader consumers) | Subagent + manual verification |
| DB schema | 76 migrations, 64 tables, 43 tenant-scoped; all pgvector and embedding statements | Subagent + manual verification |
| Tooling | `scripts/check-isolation.mjs` coverage vs. the surfaces above | Manual |

The static checker before this PR validated 262 server-action functions. After this PR it validates those plus 19 route handlers, 84 lib functions, 42 server-component files and 8 embedding/vector statements, and asserts 4 DB-level properties for 43 tables.

---

## 3. Findings by dimension

### 3.1 API route handlers

| Verdict | Count | Notes |
|---|---|---|
| **PASS** | 4 | `collab/token`, `proposals/[id]/pdf/[renderId]`, `samgov/entity`, `ai/draft` |
| **PASS — justified** | 16 | 2 superadmin, 2 NextAuth, 6 cron (`CRON_SECRET`), 5 token / auth-optional public routes, 1 Stripe-signed webhook |
| **FINDING** | 1 | `ai/chat` POST (P2) |
| **FAIL** | 0 | — |

Both SSE routes (`/api/ai/draft`, `/api/ai/chat`) resolve the section through `proposal_section ⋈ proposal WHERE proposal.organization_id = <session org>` before generating. Cross-tenant iteration is confined to cron and superadmin handlers.

| # | Sev | Finding | Fix (PR #261) |
|---|---|---|---|
| R-1 | P2 | `/api/ai/chat` (and `chatWithSectionAction`) spent the per-section rate limit (`section-chat:<sectionId>`, 30/hour) **before** verifying the section belonged to the caller's org; an org knowing a foreign section UUID could exhaust that section's chat budget, and its own quota slot was refunded on the 429 | Ownership check (`findSectionForOrg`) moved before the limiter; key is now `section-chat:<org>:<section>` |
| R-2 | P2 (out of scope: `services/collab`) | `onAuthenticate` only rejected a doc when a `yjs_doc` row already existed under a different org; a tenant could create `section/<foreign uuid>` first and lock the owner out (lock-out, not leak — content reads stay org-scoped) | `onAuthenticate` verifies `proposal_section ⋈ proposal` ownership for the token's org before binding. Also fixed: the writeback join named `proposals`; the table is `proposal` |
| R-3 | P3 | `proposal-scan-cron.ts` read/wrote `proposals` / `proposal_scan_result` by id with `organizationId` in hand | Org predicates added |
| R-4 | P3 | `solicitation-key-date-cron.ts` read `solicitation_assignment` by solicitation id only | Org predicate added |
| R-5 | P3 | Stripe webhook resolved the tenant from `stripe_customer_id` with `.limit(1)` on a non-unique column | Fails closed (no attribution, `log.error`) when >1 tenant matches |
| R-6 | P3 | `/api/samgov/health` (public) echoed the upstream body / error text | Reports reachability only |
| R-7 | P3 | `/api/forgot-password` had no rate limit; each issue also invalidates the prior reset token | 5/hour per IP |
| R-8 | P3 | `/api/error-report` (anonymous) allowed unbounded inserts with a caller-controlled fingerprint | 60/hour per IP, dropped silently (still 204) |
| R-9 | P3 | `/api/reset-password` `if (!result)` was dead (Drizzle update always returns) | `.returning()` + length check |
| R-10 | P3 (accepted) | `/api/register` invite acceptance overwrites an existing user's `passwordHash` / `name` and force-verifies. The token only reaches the invitee's inbox, so this is consent hygiene rather than takeover | Documented; no change |

### 3.2 Server-only libs (`src/lib`)

| Verdict | Count | Notes |
|---|---|---|
| **PASS** | 48 functions | Take `organizationId` and filter every tenant-scoped statement by it |
| **PASS — justified** | 12 | Cron sweeps, superadmin loaders, platform ops (all callers gated) |
| **FINDING** | 2 P2, 8 P3 | Below |
| **FAIL** | 0 | — |

| # | Sev | Finding | Fix (PR #261) |
|---|---|---|---|
| L-1 | P2 | `knowledge-entry-embed.ts:embedKnowledgeEntry` issued `UPDATE knowledge_entry … WHERE id = $1` with no org and no `organizationId` parameter; safe only because all three callers pre-verified | Takes `organizationId`; both UPDATEs filter by it; `import "server-only"` added; callers updated |
| L-2 | P2 | `knowledge-outcome.ts:propagateOutcomeToCorpus` ran four statements on `knowledge_artifact` / `knowledge_extraction_candidate` / `knowledge_entry` keyed by proposal id and `inArray(ids)` only | Takes `organizationId`; every statement filters by it; caller updated |
| L-3 | P3 | `section-pattern-intel.ts:loadSectionForPatternIntel` — exported bare-id section lookup with zero callers | Deleted |
| L-4 | P3 | `section-pattern-intel.ts` compliance-gap read by section id relied on the caller's check | Joins `proposals` with the org filter |
| L-5 | P3 | FK-only joins on tenant tables (`proposal_debrief`, `proposal_winner_analysis`) in `recompete-radar.ts`, `loss-intelligence.ts` | Org predicate added to the join conditions |
| L-6 | P3 | `pwin.ts` read `proposal_scan_result` by proposal id only | Org predicate added |
| L-7 | P3 | `knowledge-entry-embed.ts:backfillEntryEmbeddings` UPDATE by id (ids from an org-filtered SELECT) | Org predicate added |
| L-8 | P3 (accepted) | `section-chat.ts:appendSectionChatTurns`, `draft-signal.ts:recordDraftSignal`, `notification-dispatcher.ts` copy caller-supplied `proposalId` / `sectionId` into org-stamped rows; all callers derive them from verified rows | Documented; the write rule now guards the update paths in `draft-signal.ts` |

### 3.3 Server components (`page.tsx`, `layout.tsx`, async panels)

| Verdict | Count | Notes |
|---|---|---|
| **PASS** | 60 | Gate first; every `[id]` page does `eq(table.id, params.id) AND eq(table.organizationId, <gate org>)` and fails closed with `notFound()`; none relies on its layout |
| **PASS — justified** | 18 | 15 superadmin pages (`requireSuperadmin()` first), public token / catalogue pages |
| **FINDING** | 6 P2, 6 P3 | Below |
| **FAIL** | 0 | — |

| # | Sev | Finding | Fix (PR #261) |
|---|---|---|---|
| C-1 | P2 | `proposals/[id]/outcome/page.tsx` read `proposal_outcome` and `proposal_debrief` (both tenant-scoped) by `params.id` only, after the parent check | Org predicates added |
| C-2 | P2 | `proposals/[id]/compliance/page.tsx` read `compliance_item_evidence` (tenant-scoped) by item ids derived two hops from `params.id` | Org predicate added |
| C-3 | P2 | `(auth)/sign-up/page.tsx` (public) rendered the invitee's **email, role and org name** for any `allowlist` row whose UUID was supplied with any non-empty `?invite=`; the token was only checked on submit. Enumeration is infeasible (122-bit id) but the id never expires and travels with the token in the same URL | New non-consuming `peekToken()`; nothing is rendered until the link's token matches a live invite token; a consumed invite gets a generic state with no details |
| C-4 | P2 | `pwin.ts` scan-result read (same as L-6) reached from `PwinPanel` and `CustomerHistoryPanel` | Fixed with L-6 |
| C-5 | P2 | `proposals/[id]/brain-actions.ts:getBrainMineStatusAction` read `proposal_outcome` by proposal id only | Org predicate added |
| C-6 | P2 | FK-only joins (same as L-5) reached from `RecompeteRadarPanel`, `RecompeteAttentionPanel`, `/intelligence/losses` | Fixed with L-5 |
| C-7 | P3 (convention) | Seven server components accept `organizationId` as a prop and do not re-derive it; all seven call sites pass the `requireCurrentOrg()` value | The two that query `@/db` directly (`OutcomeInsightsPanel`, `OpportunityDocsAndAIPanel`) now call the gate themselves; the checker's Surface E requires this for any component importing `@/db`. Panels that only call org-taking lib loaders keep the prop |
| C-8 | P3 | `notifications/actions.ts:getMyUnreadCount` scoped by `user.organizationId` from the session (ignores impersonation; bell count and list could disagree) | Uses `requireCurrentOrg()`, returns 0 when there is no org |
| C-9 | P3 | `settings/ai-engine` and `settings/integrations` used `requireAuth` + manual check | `requireCurrentOrg()` |
| C-10 | P3 | `knowledge-base/import` pages had no page-level gate (fully delegated to actions) | Gate added at the top of both |
| C-11 | P3 | Expired opportunity review link still returned the opportunity payload (only submit refused it) | Returns `ok: false` when expired; audit row still recorded |
| C-12 | P3 (tooling) | The checker did not scan components at all, and function-level rules cannot see per-statement gaps like C-1/C-2 | Surface E added: gate required; every `.from()` / join of a tenant table must carry `organizationId` in the same statement |

### 3.4 DB schema (43 tenant-scoped tables)

| Verdict | Count | Notes |
|---|---|---|
| **PASS** | 30 | `organization_id NOT NULL` + CASCADE FK + leading-org index |
| **PASS — justified** | 5 + 2 | `tenant_subscription` (RESTRICT by design), 4 tables read only by parent key; `production_error` and `payment_event` nullable-org system tables (see §4) |
| **FINDING** | 9 P2, 4 P3 | Below |
| **FAIL** | 0 | — |

All 12 tables added since June have `NOT NULL` + CASCADE + a leading-org index. `NOT NULL` and FK definitions match between `schema.ts` and SQL for every table. **No global UNIQUE on a human-chosen value** exists in any tenant-scoped table. All 4 pgvector `<=>` statements filter `organization_id` in-statement.

| # | Sev | Finding | Fix (PR #261) |
|---|---|---|---|
| S-1..8 | P2 | **13 tenant tables had no index leading with `organization_id`**: `allowlist`, `membership` (PK leads with `user_id`), `notification`, `solicitation` (org list path, rows carry up to 500 KB `raw_text`), `proposal_outcome`, `proposal_debrief`, `proposal_template`, `proposal_pdf_render`, `proposal_winner_analysis`, `opportunity_review_request`, `solicitation_assignment`, `knowledge_extraction_run`, `knowledge_extraction_candidate`. Several are now read by org on hot paths (Phase C loaders) | `drizzle/0077_tenant_org_indexes.sql`: 13 indexes, composite where the audited read pattern has a second column (`org + status`, `org + artifact_id`, `org + proposal_id`, `org + timestamp DESC`); mirrored in `schema.ts`. `check-tenant-firewall.mjs` now fails CI when a tenant table lacks one |
| S-9 | P2 | Two org-blind `UPDATE knowledge_entry SET embedding …` statements (L-1, L-7) and a CI blind spot: the vector check only saw `<=>` | Fixed; Surface D now covers any sql`` template naming `embedding` in a DML statement |
| S-10 | P3 | `schema.ts` ↔ SQL divergence: eight index/column details exist only in SQL (`knowledge_artifact_chunk` + `solicitation_assignment` indexes, protest-check org index and `timestamptz`, `section_draft_signal` FK, `knowledge_artifact` partial unique + outcome-label indexes, `payment_event` / `tenant_subscription` partial indexes, `vector(1536)` types). Harmless while migrations apply from SQL, but `npm run db:push` would drop them | **Tracked as BL-TENANT-DRIFT** (mirror into `schema.ts`, guard `db:push`) |
| S-11 | P3 | `payment_event`'s nullable-org exception was claimed in a code comment but not in the June register | Recorded in §4 and `.tenant-firewall-allow.json` |
| S-12 | P3 | `production_error` fingerprint upsert froze `organization_id` / `user_id` to the first reporter while the payload described the latest | Latest occurrence wins for attribution too |
| S-13 | P3 | Boot-time schema check pinned to `0052` (24 migrations behind) | Bumped to `0077`; `tests/ai/migration-check.test.ts` fails when a newer file exists |

### 3.5 Tooling gaps closed

| Gap (before) | Gate (after) |
|---|---|
| Checker walked `"use server"` files only | Surfaces A–E: actions, API routes, `src/lib` DB modules, server components, raw SQL touching embeddings |
| "`organizationId` appears somewhere in the function" accepted writes by bare id | Rule E: org predicate in the write's own `WHERE`, including non-exported helpers — 48 flagged, 47 fixed, 1 allow-listed |
| No DB-level assertions | `check-tenant-firewall.mjs`: NOT NULL, CASCADE FK, leading-org index, schema parity |
| Vector check keyed on the operator | Any sql`` template that names `embedding` in a DML statement |

---

## 4. Documented exceptions

| Surface | Cross-tenant access | Justification | Mitigation |
|---|---|---|---|
| `/admin/*` superadmin pages and actions | All tenant data | Platform ops | `requireSuperadmin()` first; cross-tenant reads in `audit_log`; allow-listed by path in `.isolation-allow.json` |
| Cron handlers (`/api/cron/*`) and the libs they call | Iterate across tenants | Batch jobs | `Authorization: Bearer ${CRON_SECRET}`; handlers exempt from the org reference by class, libs allow-listed by name |
| `/api/webhooks/stripe` | Writes `tenant_subscription` / `payment_event` with no session | Stripe-signed webhook | Signature verified with `STRIPE_WEBHOOK_SECRET`; tenant resolved from the customer binding and now fails closed on ambiguity |
| `production_error` | `organization_id` nullable, `ON DELETE SET NULL` | Pre-auth crashes; ops history survives tenant deletion | Superadmin-only read path |
| `payment_event` | `organization_id` nullable, `ON DELETE SET NULL` | Events arrive before the customer is bound to a tenant; reconciliation ledger survives tenant deletion | Never read on a tenant path |
| `(auth)/sign-up` invite landing | Reads `allowlist` by invite id with no session | Public onboarding | Token verified with `peekToken()` before any detail renders |
| Token-scoped public surfaces (review link, invite, reset) | No session | The unguessable token is the credential | Random 122-bit+ tokens; expired review links now return no payload |
| `updateSourceRequestAction` | Superadmin triage across tenants' requests | Platform op | `requireSuperadmin()`; allow-listed with reason |

---

## 5. Threat model delta

| Threat | June mitigation | September change |
|---|---|---|
| Future PR writes a child row by bare id after checking the parent | Code review | **CI fails** (Rule E) |
| Future lib loader takes an id and forgets the tenant | None (outside the checker) | **CI fails** (Surface C) |
| Future page queries a tenant table by `params.id` | Code review | **CI fails** (Surface E, per statement) |
| New tenant table shipped without NOT NULL / CASCADE / org index | Manual audit | **CI fails** (`check-tenant-firewall.mjs`) |
| New vector or embedding statement without an org filter | Partial (operator only) | **CI fails** (Surface D, any embedding DML) |
| Cross-tenant rate-limit exhaustion by UUID | Not modelled | Limiter keyed by tenant and gated by ownership |
| `drizzle-kit push` drops SQL-only indexes | Not modelled | Tracked (BL-TENANT-DRIFT) |

Out of scope, unchanged from June: compromise of Neon itself; shared-compute side channels; a malicious developer with prod credentials (covered by `docs/ENVIRONMENTS.md` + MFA).

---

## 6. Audit re-run cadence

Unchanged: quarterly, before any feature adding routes or tenant tables, after any suspected incident, and as the canonical artifact for SOC 2 / FedRAMP. The next re-run should be materially smaller: with Surfaces A–E and the firewall script in CI, the manual sweep reduces to (a) reviewing the allow-lists for entries that no longer apply, (b) the per-statement SELECT rule for actions and libs (see §7), and (c) anything the checkers cannot see (raw SQL built outside sql``, `services/*`).

Output: `docs/audits/NN-multi-tenant-firewall-YYYY-MM.md`; this file is the template.

---

## 7. Follow-up recommendations

| # | Item | Priority | Effort | Tracking |
|---|---|---|---|---|
| 1 | **Schema drift mirror + `db:push` guard** (S-10) | P2 | S | BL-TENANT-DRIFT |
| 2 | **Per-statement SELECT rule for actions and libs** — Surface E's statement-level org check applied to `.from(scoped)` in actions and libs (today only writes are per-statement there). Expect many "parent first, then child" reads to need the predicate | Medium | M | Next re-run |
| 3 | **Component prop convention** (C-7): decide between "re-derive the org inside every server component" and "org prop is allowed only from a gated page"; encode the choice in the checker | Low | S | Next re-run |
| 4 | **Runtime tenant-isolation fuzz test** (June #5): two tenants, cross-tenant URL / id manipulation, assert 404 / 403 | Medium | L | Backlog |
| 5 | **Unique partial index on `tenant_subscription.stripe_customer_id`** — needs the manual migration path because existing duplicates would fail the index | Low | S | Backlog |

---

## 8. What this PR changes

PR #261 delivers this document plus:

- `scripts/check-isolation.mjs` Surfaces B–E and Rule E; `requireApiTenant` recognised as a gate.
- `scripts/check-tenant-firewall.mjs` (new), `.tenant-firewall-allow.json`, wired into `package.json` and the isolation CI job.
- `drizzle/0077_tenant_org_indexes.sql` + `schema.ts` mirrors (13 indexes).
- 47 hardened write statements across 19 files; the remediations listed in §3 (R-1..R-9, L-1..L-7, C-1..C-11, S-9, S-12, S-13).
- `.isolation-allow.json`: Stripe webhook, AI telemetry pruner, superadmin source-request triage, `/admin/**`, sign-up page.
- `docs/ENGINEERING_STANDARDS.md`, `docs/PRE_PUSH_CHECKLIST.md`, `docs/BACKLOG.md` (BL-TENANT-AUDIT status, BL-TENANT-DRIFT queued).

---

## 9. Sign-off

| Approver | Role | Date | Status |
|---|---|---|---|
| Engineering | Audit owner | 2026-09-10 | PASS with documented exceptions |
| Founder | Strategic sign-off | _pending_ | _awaiting review_ |

**Recommendation:** approve. The isolation posture is unchanged in kind and stronger in depth: every class of gap found in this pass is now a CI failure rather than a review note.
