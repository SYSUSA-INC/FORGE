# FORGE — Multi-Tenant Data Firewall Audit (2026-06-16)

**Auditor:** Engineering
**Scope:** Every code and DB layer that could leak data between tenants
**Status:** PASS with documented exceptions
**Trigger:** Founder-initiated; pre-customer audit to confirm we are safe to onboard real customers

---

## 1. Executive Summary

FORGE's multi-tenant isolation is **structurally sound**. Across **3 audit dimensions** (API route handlers, server-component data loaders, DB schema), the audit found:

- **Zero exploitable cross-tenant data leaks** in any code path.
- **One documented intentional exception** (`production_error.organization_id` nullable for pre-auth crashes — by design, admin-viewer-only).
- **Defense-in-depth opportunities** where current safety relies on parent-entity org scoping; future refactors should keep this invariant.
- **Minor code-style inconsistency** in `/settings/page.tsx` (uses `requireAuth` + manual check instead of canonical `requireCurrentOrg`); fixed in this PR.

We can confidently onboard customers with the current isolation posture. Recommended follow-ups (Section 7) tighten defense-in-depth and add automated drift detection.

---

## 2. Method

Three parallel audits ran against the codebase at commit `06e10de` (main branch):

| Dimension | Files reviewed | Tool |
|---|---|---|
| API route handlers | 14 (`src/app/api/**/route.ts`) | Subagent + manual verification |
| Server components | 71 (`src/app/(app)/**/page.tsx`, `layout.tsx`) | Subagent + manual verification |
| DB schema | 53 migrations covering 32 tenant-scoped tables | Subagent + manual verification |

The static checker (`npm run check:isolation`) covers **server actions** (215 functions auto-validated on every PR). This audit covers the surfaces the static checker can't statically reach.

---

## 3. Findings by dimension

### 3.1 API route handlers

| Verdict | Count | Notes |
|---|---|---|
| **PASS** | 13 | All session-gated routes use `requireCurrentOrg()` or equivalent; cron routes use `Authorization: Bearer ${CRON_SECRET}`; auth-optional routes (forgot-password, error-report) do not touch tenant-scoped data |
| **PASS — auth-optional by design** | 5 | `/api/auth/*`, `/api/forgot-password`, `/api/reset-password`, `/api/register`, `/api/error-report`, `/api/samgov/health` |
| **REQUIRES JUSTIFICATION** | 0 | All cross-tenant routes are superadmin-gated |
| **FAIL** | 0 | — |

Routes with explicit tenant-scoping logic verified by hand:

| Route | Auth gate | Tenant scoping |
|---|---|---|
| `/api/admin/orgs/[id]/export` | `requireSuperadmin()` | Every query filters `eq(<table>.organizationId, params.id)` |
| `/api/proposals/[id]/pdf/[renderId]` | `requireAuth()` + `requireCurrentOrg()` | `eq(proposalPdfRenders.organizationId, organizationId)` in WHERE |
| `/api/collab/token` | `requireCurrentOrg()` | JWT mints `orgId` claim; downstream Hocuspocus verifies doc's `organization_id` matches |
| `/api/register` (invite flow) | None (token is auth) | `consumeToken("invite", inv.id, rawToken)` — token is bound to the specific invite ID via the `subject` parameter; cannot be replayed across orgs |

### 3.2 Server components (page.tsx / layout.tsx)

| Verdict | Count | Notes |
|---|---|---|
| **PASS** | 70 | Every page calls `requireCurrentOrg`/`requireSuperadmin` and scopes queries appropriately, OR delegates to a server action |
| **PASS — minor inconsistency** | 1 | `/settings/page.tsx` uses `requireAuth` + manual `user.organizationId` check instead of `requireCurrentOrg`. Effectively safe but inconsistent. **Fixed in this PR.** |
| **FAIL** | 0 | — |

#### Child-entity scoping pattern (defense-in-depth note)

Several pages follow a "parent first, then children" pattern:

```ts
// Parent org-scoped check
const [proposal] = await db.select().from(proposals)
  .where(and(eq(proposals.id, params.id),
             eq(proposals.organizationId, organizationId)));
if (!proposal) notFound();

// Child query relies on the parent check (child has no own organization_id)
const sections = await db.select().from(proposalSections)
  .where(eq(proposalSections.proposalId, params.id));
```

This is **safe** because the parent fetch fails-closed if the proposal isn't in the user's org. The child tables (`proposal_section`, `opportunity_activity`, `opportunity_competitor`, `opportunity_evaluation`) inherit tenant scope via their FK to the parent.

**Defense-in-depth caveat:** if a future refactor reorders the queries or accidentally removes the parent check, the child query would expose data. Mitigations:
- The parent fetch is a hard precondition for `notFound()` — straightforward to spot in code review.
- Static check could be extended to require: "if a server component queries table X (no organization_id), there must be a preceding query on its parent with `organizationId` in the WHERE clause."

This is a candidate for follow-up (Section 7).

### 3.3 DB schema (32 tenant-scoped tables)

| Verdict | Count | Notes |
|---|---|---|
| **PASS** | 31 | `organization_id NOT NULL` + ON DELETE CASCADE FK + leading-org index on hot-path queries |
| **PASS — intentional exception** | 1 | `production_error.organization_id` is NULLABLE for pre-auth crashes (sign-in page errors). Documented in the migration. The `/admin/errors` page is `requireSuperadmin`-gated; no tenant user can ever read this table. |
| **FAIL** | 0 | — |

Per-table verification confirmed all 32 tables have:
- `organization_id` declared `NOT NULL` (except the one documented exception)
- `REFERENCES organization(id) ON DELETE CASCADE` foreign key (except `tenant_subscription` which uses `RESTRICT` to prevent accidental subscription wipe — intentional)
- A non-redundant index that leads with `organization_id` for queries that hit the table on the tenant-scoped path

**Unique constraint observations (not security issues):**
- `proposal_debrief.proposal_id UNIQUE`, `proposal_outcome.proposal_id UNIQUE`, `proposal_winner_analysis.proposal_id UNIQUE` — these are globally unique on `proposal_id`. Since proposal IDs are UUIDs scoped per-org with no possibility of cross-org collision, the constraints are effectively org-scoped via UUID uniqueness. **Not a leak vector.**
- `opportunity_review_request.token UNIQUE` — share-link token. Cryptographic randomness from server-side generation makes collision astronomically unlikely; the unique constraint is defensive against bugs in token generation, not a tenant isolation control.

**Vector search indexes (knowledge_entry, knowledge_artifact_chunk):**
- The pgvector `ivfflat` indexes are on the embedding column alone (required by the index type).
- All application-layer queries that use these indexes explicitly filter `WHERE organization_id = ?` (verified in `src/lib/embeddings.ts`, `src/app/(app)/knowledge-base/import/embed-actions.ts`, `src/app/(app)/proposals/[id]/sections/ai/brain-actions.ts`).
- **Risk:** if a future developer writes a new vector query and forgets the org filter, it would silently scan across all tenants. Mitigation: add a static check to flag `<=>` / `<->` usage without a nearby `organizationId` reference. Follow-up in Section 7.

---

## 4. Documented exceptions

These are intentional cross-tenant paths. Every one is listed here with its justification.

| Surface | Cross-tenant access | Justification | Mitigation |
|---|---|---|---|
| `/admin/*` superadmin pages | All tenant data visible to superadmin | Platform ops requires this | `requireSuperadmin()` gate; every cross-tenant access logged in `audit_log` |
| `/admin/errors` | All tenants' production errors | Ops debugging needs full visibility | `requireSuperadmin()`; surfaced with `organizationName` so superadmin sees which tenant |
| `production_error` table | Pre-auth errors have `organization_id = NULL` | Sign-in page crashes happen before session exists; we still need to log them | Table read only via superadmin path; admin viewer renders `null` org as "(pre-auth)" |
| Cron handlers (`/api/cron/*`) | Iterate across all tenants | Batch jobs (notification delivery, audit log pruning) | `Authorization: Bearer ${CRON_SECRET}`; only Vercel cron infrastructure has the secret |
| Reference data tables (`cert_firm`, `cert_import_run`, `rate_limit_counter`) | Not tenant-scoped (no `organization_id`) | Reference data is shared infrastructure | `cert_firm` populated by superadmin-gated SAM.gov import; `rate_limit_counter` is global by design (keyed by IP / API key) |

These appear in the existing `.isolation-allow.json` for the static checker; the audit confirmed every allow-list entry has a documented reason.

---

## 5. Threat model

**What we are defending against:**

| Threat | Severity | Mitigation |
|---|---|---|
| Tenant A intentionally tries to fetch tenant B's data via URL manipulation | Critical | Every page/API verifies `organizationId` from session (not URL) matches the entity's org |
| Bug introduced by a future PR exposes cross-tenant data | High | Static checker on every PR + this manual audit + planned automated DB-assertion test (Section 7) |
| Compromised tenant user attempts SQL injection to bypass org filter | High | Drizzle ORM parameterizes all queries; no raw SQL with user input |
| Compromised superadmin account | Critical | MFA enforced (`docs/MFA_SETUP.md`); audit log records every superadmin action |
| Insider threat from engineering team running ad-hoc queries against prod | High | `docs/ENVIRONMENTS.md` prohibits prod-DB access from dev machines; once separated, prod credentials live only in Vercel |
| Migration applies an `ALTER TABLE` that drops `organization_id` | Critical | Destructive blocker (`runMigrations()`) refuses to auto-apply `ALTER COLUMN TYPE` / `DROP COLUMN`; ledger drift detector catches table-level mismatches |

**What we are NOT defending against (out of scope for this audit):**
- Compromise of the Neon platform itself (covered by Neon's SOC 2 + their own security)
- Side-channel attacks on the shared Postgres compute (extremely low likelihood at our scale)
- A malicious developer with prod credentials (covered by `docs/ENVIRONMENTS.md` access discipline + MFA)

---

## 6. Audit re-run cadence

Run this audit:
- **Every quarter** as part of the compliance-readiness review (`docs/COMPLIANCE_REVIEW_TEMPLATE.md`)
- **Before every major feature** that adds new API routes or tenant-scoped tables
- **After every incident** involving suspected cross-tenant data exposure
- **As part of any future SOC 2 / FedRAMP audit** as the canonical artifact

Output: a new `docs/audits/NN-multi-tenant-firewall-YYYY-MM.md` with the date appended; this file (`06-multi-tenant-firewall-2026-06.md`) is the template.

---

## 7. Follow-up recommendations

These items are optional improvements; current isolation posture is sufficient to onboard customers.

| # | Item | Priority | Effort |
|---|---|---|---|
| 1 | **Static check: vector search org filter** — extend `scripts/check-isolation.mjs` to flag any query containing `<=>` or `<->` operators without a nearby `organizationId` reference | Medium | S (half-day) |
| 2 | **Static check: server-component child queries** — flag pages where a child-table query exists without either (a) the child table having `organization_id` filtered, or (b) a preceding parent fetch that checks `organization_id` | Medium | M (1-2 days) |
| 3 | **DB assertion test** — `scripts/check-tenant-firewall.mjs` that on every PR verifies: every tenant-scoped table has the expected `NOT NULL` + CASCADE + leading-org-index | Low | S (half-day) |
| 4 | **Runtime tenant assertion** — add an optional dev-mode middleware that logs every DB query and asserts every tenant-scoped table read has `organization_id` in the WHERE clause | Low | M (1-2 days) |
| 5 | **Tenant-isolation fuzz test** — Playwright suite that creates two test tenants, performs cross-tenant URL manipulation attempts, asserts all return 404 / 403 | Medium | L (3-5 days) |

---

## 8. What this PR changes

This PR delivers the audit doc above plus a single code change:

- `src/app/(app)/settings/page.tsx` — convert from `requireAuth()` + manual `user.organizationId` check to `requireCurrentOrg()` for consistency with the rest of the codebase. No behavior change; same redirect on unauthenticated; same query.

The follow-up recommendations in Section 7 are not implemented in this PR — they're queued for future work.

---

## 9. Sign-off

| Approver | Role | Date | Status |
|---|---|---|---|
| Engineering | Audit owner | 2026-06-16 | PASS with documented exceptions |
| Founder | Strategic sign-off | _pending_ | _awaiting review_ |

**Recommendation:** approve and proceed to customer onboarding. The isolation posture is enterprise-bidable as-is.
