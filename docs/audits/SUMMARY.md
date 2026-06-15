# FORGE Codebase Audit — 2026-05-03

Five-pass audit conducted before adding Platform Administration features (multi-tenant tier management, billing, subscriptions, cross-tenant audit log) on top of the current codebase. The user pointed out — correctly — that we've been shipping features fast and applying band-aids rather than auditing the foundation. This audit is the foundation check.

Audit dispatched in parallel by five read-only Explore agents. Each report is its own file in this directory.

## Reports

| # | Pass | File | Status |
|---|---|---|---|
| 1 | Security (authn/authz, secrets, OWASP, abuse) | [01-security.md](./01-security.md) | ✅ |
| 2 | Multi-tenancy data isolation | [02-multi-tenancy.md](./02-multi-tenancy.md) | ✅ |
| 3 | Data integrity & transactions | [03-data-integrity.md](./03-data-integrity.md) | ✅ |
| 4 | Performance & efficiency | [04-performance.md](./04-performance.md) | ✅ |
| 5 | Code quality & operational readiness | [05-code-quality.md](./05-code-quality.md) | ✅ |

## Severity scale

- **P0** — exploitable today OR causes data corruption today OR breaks production at current scale. Must fix before any other feature work.
- **P1** — exploitable under specific conditions, OR breaks at near-term scale, OR represents a material operational gap.
- **P2** — defense-in-depth gap, brittle pattern, won't bite today but will during scale or refactor.
- **P3** — informational / nitpick.

## Aggregate finding count

| Pass | P0 | P1 | P2 | P3 | Total |
|---|---|---|---|---|---|
| 1 — Security | **2** | 3 | 4 | 1 | 10 |
| 2 — Multi-tenancy | **6** | 0 | 2 | 1 | 9 |
| 3 — Data integrity | **2** | 1 | 2 | 1 | 6 |
| 4 — Performance | **6** | 2 | 2 | 2 | 12 |
| 5 — Code quality | 0 | 4 | 4 | 2 | 10 |
| **Total** | **16** | **10** | **14** | **7** | **47** |

## What's working well (so we don't fix what isn't broken)

The audit also surfaced what's solid — keep these patterns:

- **Auth helpers** are correctly designed and consistently applied at action entry points (`requireAuth`, `requireCurrentOrg`, `requireOrgAdmin`, `requireSuperadmin`). The bug is downstream of the helpers, not in them.
- **Drizzle parametrization** prevents SQL injection across the codebase. No raw SQL with user-input interpolation found.
- **Token-authed flows** (magic-link review at `/review/[token]`, password reset, email verification) are correctly scoped by opaque random tokens.
- **Foreign-key cascades** are correct. No cascade-related orphan risks found.
- **Migration consistency** — schema.ts and SQL files align. The `0016` and `0025` gaps are intentional renumbering, not drift.
- **No N+1 query loops** — server actions consistently use `Promise.all` and batched lookups.
- **CSRF protection** via Next.js Server Actions is automatic and consistently used.
- **Embedding infrastructure** (pgvector + IVFFlat indexes) is production-ready.
- **Stub-mode pattern** is the right approach for graceful degradation when env vars are missing.

## P0 summary by category

### Multi-tenancy (6 P0s) — most critical

Every one of these allows an authenticated user in Org A to mutate or delete data in Org B by guessing/observing an id. The auth helpers correctly establish `organizationId` from the session, but the actual UPDATE/DELETE statements only filter by `id`, not `id + organizationId`. The pattern is "verify input on entry, trust it for the rest of the function" — classic TOCTOU bug.

| File:line | Action | Issue |
|---|---|---|
| `src/app/(app)/proposals/actions.ts:241` | `updateProposalAction` | UPDATE missing `organizationId` filter |
| `src/app/(app)/proposals/actions.ts:269` | `advanceProposalStageAction` | UPDATE missing `organizationId` filter |
| `src/app/(app)/proposals/actions.ts:281` | `advanceProposalStageAction` (submittedAt) | UPDATE missing `organizationId` filter |
| `src/app/(app)/proposals/actions.ts:317` | `deleteProposalAction` | DELETE missing `organizationId` filter |
| `src/app/(app)/companies/actions.ts:121` | `updateCompanyAction` | UPDATE missing `organizationId` filter |
| `src/app/(app)/companies/actions.ts:142` | `deleteCompanyAction` | DELETE missing `organizationId` filter |

**Fix is mechanical:** add `eq(table.organizationId, organizationId)` to each WHERE clause. ~30 minutes of work + tests. **One PR.**

### Security (2 P0s) — open redirects

Both in the sign-in flow, both allow phishing redirects to attacker domains.

| File:line | Issue |
|---|---|
| `src/app/(auth)/sign-in/page.tsx:14` | `searchParams.callbackUrl` used in `redirect()` without validation |
| `src/app/(auth)/sign-in/SignInForm.tsx:27` | `window.location.href = callbackUrl` without validation |

**Fix:** add `isAllowedRedirect(url)` helper that requires URL starts with `/` and not `//`. Apply server-side and client-side. **One PR.**

### Data integrity (2 P0s) — race conditions and partial writes

| File:line | Issue |
|---|---|
| `src/app/(app)/proposals/[id]/harvest-actions.ts:99–118` | Race condition: concurrent harvests create duplicate artifacts |
| `src/app/(app)/knowledge-base/import/embed-actions.ts:66–90` | Failed mid-batch insert leaves orphaned chunks (no rollback) |

**Fix:** add unique constraint on `(organizationId, source, metadata->'proposalId')` for harvest; wrap each chunk insert in try-catch with rollback for embed. **One PR (schema migration + code).**

### Performance (6 P0s) — missing indexes on hot paths

Postgres doesn't auto-index foreign keys. Every tenant-scoped list page does a sequential scan today.

| Index | Table.column |
|---|---|
| 1 | `notification.recipient_user_id` |
| 2 | `opportunity.organization_id` |
| 3 | `proposal.organization_id` |
| 4 | `proposal_section.proposal_id` |
| 5 | `company.organization_id` |
| 6 | `compliance_item.proposal_id` |

**Fix:** one migration with 6 `CREATE INDEX` statements. ~10 minutes. Schema-only, zero risk.

## Recommended fix sequence (10 PRs)

See [FIX_PLAN.md](./FIX_PLAN.md) for the full priority-ordered plan.

The quick view:

1. **PR-1: Multi-tenancy hardening** (P0 × 6) — block all feature work until this lands
2. **PR-2: Open redirect fix** (P0 × 2)
3. **PR-3: Data integrity hot fixes** (P0 × 2 + 1 P1)
4. **PR-4: Missing indexes migration** (P0 × 6 + P1 × 2)
5. **PR-5: Rate limiting + abuse protection** (P1 × 3) — register, review, AI endpoints
6. **PR-6: Markdown sanitization + auth gap on /api/samgov/entity** (P2 × 2)
7. **PR-7: Action return-shape normalization + zod validation on AI JSON** (P1 × 2 from Pass 5)
8. **PR-8: In-app error log — BL-QC-errors** (P1 from Pass 5) — `production_error` table + `/admin/errors` viewer; replaces the Sentry integration that was originally drafted but retired (BL-QC-sentry-retire)
9. **PR-9: JSONB default consistency + minor data-integrity P2s** (P2 × 3)
10. **PR-10: Stub-mode UX unification + env-var validation on boot** (P2/P3 cleanup)

## What this means for the broader plan

The user's broader vision (Chapters 16–21: nav restructure, pipeline, GSA paste, collaborative editor, tier billing, tenant administration) **must wait** until at least PR-1 through PR-4 land. Multi-tenancy bugs amplify into platform-wide leaks the moment we add cross-tenant features. Indexes amplify into outages the moment customer data sets grow.

After PR-1 through PR-4 land, Chapters 16+ can resume in parallel with the remaining audit fixes (PR-5 through PR-10), since those are isolated improvements rather than blockers.
