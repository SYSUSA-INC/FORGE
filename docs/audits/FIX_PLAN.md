# Audit Fix Plan — 2026-05-03

Priority-ordered fix sequence for findings in [SUMMARY.md](./SUMMARY.md). Ten PRs, each with a clear scope and a clean exit criterion. Most are 1-day or less; the largest (rate limiting + observability) are 2-3 days.

**Hard rule:** PR-1 through PR-4 block all feature work. PR-5 through PR-10 can run in parallel with feature work after the blockers land.

---

## PR-1 — Multi-tenancy hardening (BLOCKER)

**Scope:** add `organizationId` filter to every UPDATE/DELETE statement that currently filters only by id.

**Files:**
- `src/app/(app)/proposals/actions.ts:241, 269, 281, 317`
- `src/app/(app)/companies/actions.ts:121, 142`
- Sweep every other action file for the same pattern (assume more)

**Verification:**
1. Manual code review — every Drizzle UPDATE/DELETE on a tenant-scoped table has both `eq(table.id, id)` AND `eq(table.organizationId, organizationId)` in the WHERE
2. Add an integration test (the first one): create two orgs, sign in as Org A user, try to delete Org B's proposal by id → must fail
3. After merge: spot-check `/admin` to verify normal flows still work

**Effort:** 4 hours (mostly the sweep + test setup).

---

## PR-2 — Open-redirect fix

**Scope:** validate `callbackUrl` in the sign-in flow.

**Files:**
- `src/app/(auth)/sign-in/page.tsx:14`
- `src/app/(auth)/sign-in/SignInForm.tsx:27`
- New helper: `src/lib/safe-redirect.ts` with `isAllowedRedirect(url)`

**Implementation:**
```ts
export function isAllowedRedirect(url: string): boolean {
  if (!url) return false;
  if (!url.startsWith("/")) return false; // must be relative
  if (url.startsWith("//")) return false; // protocol-relative URL
  if (url.startsWith("/api/")) return false; // never redirect into APIs
  return true;
}
```

**Verification:**
- `?callbackUrl=https://attacker.com` → falls back to `/`
- `?callbackUrl=//attacker.com` → falls back to `/`
- `?callbackUrl=/proposals/abc` → redirects normally

**Effort:** 1 hour.

---

## PR-3 — Data integrity hot fixes

**Scope:** fix the harvest race + the embed partial-insert + the allowlist orphan.

**Files:**
- `src/app/(app)/proposals/[id]/harvest-actions.ts:99–118`
- `src/app/(app)/knowledge-base/import/embed-actions.ts:66–90`
- `src/app/api/register/route.ts:125–149` (acceptInvite)
- New migration: `drizzle/0029_data_integrity_constraints.sql`

**Implementation:**
- **Harvest race:** add unique constraint `CREATE UNIQUE INDEX knowledge_artifact_proposal_unique ON knowledge_artifact (organization_id, source, (metadata->>'proposalId')) WHERE source = 'mined_from_proposal'`. On insert collision, the action selects the existing artifact instead of creating a duplicate.
- **Embed partial-insert:** wrap each `db.execute()` chunk insert in try-catch. If any chunk fails, delete all newly-inserted chunks for that artifact (use a session-local marker like `inserted_at = same timestamp`).
- **Allowlist orphan:** in `acceptInvite`, only call `db.update(allowlist, { consumedAt })` AFTER the membership insert succeeds.

**Verification:**
- Concurrent double-click test on harvest button — only one artifact created
- Force-fail mid-embed (mock the 50th insert to throw) — no orphan chunks
- Force-fail membership insert during invite consumption — allowlist still consumable

**Effort:** 4 hours.

---

## PR-4 — Missing indexes migration

**Scope:** one Drizzle migration creating six P0 + two P1 indexes.

**Files:**
- New migration: `drizzle/0030_add_missing_indexes.sql`

**Migration:**
```sql
-- P0: tenant-scoped list pages — these scan the full table today
CREATE INDEX IF NOT EXISTS notification_recipient_user_id_idx ON notification(recipient_user_id);
CREATE INDEX IF NOT EXISTS opportunity_organization_id_idx ON opportunity(organization_id);
CREATE INDEX IF NOT EXISTS proposal_organization_id_idx ON proposal(organization_id);
CREATE INDEX IF NOT EXISTS proposal_section_proposal_id_idx ON proposal_section(proposal_id);
CREATE INDEX IF NOT EXISTS company_organization_id_idx ON company(organization_id);
CREATE INDEX IF NOT EXISTS compliance_item_proposal_id_idx ON compliance_item(proposal_id);

-- P1: knowledge fallback queries
CREATE INDEX IF NOT EXISTS knowledge_entry_organization_id_idx ON knowledge_entry(organization_id);
CREATE INDEX IF NOT EXISTS knowledge_artifact_organization_id_idx ON knowledge_artifact(organization_id);
```

**Verification:**
- After deploy, verify with `\d+ proposal` (or Neon console) that the indexes exist
- Spot-check query plan for `/proposals` list with `EXPLAIN ANALYZE` — should show Index Scan, not Seq Scan
- Add the indexes to `src/db/schema.ts` so future migrations don't drift

**Effort:** 1 hour. Zero risk migration.

---

## PR-5 — Rate limiting + abuse protection

**Scope:** add rate limiting to `/api/register`, magic-link review request, and AI endpoints.

**Files:**
- New helper: `src/lib/rate-limit.ts` (Upstash Redis or Vercel KV — pick whichever you already have credentials for)
- Middleware or per-route checks in:
  - `src/app/api/register/route.ts`
  - `src/app/(app)/opportunities/[id]/review/actions.ts`
  - `src/app/(app)/proposals/[id]/sections/ai/actions.ts` (auto-draft)
  - `src/app/(app)/proposals/[id]/compliance/actions.ts` (pre-flight)
  - `src/app/(app)/proposals/[id]/outcome/winner-actions.ts` (winner analysis)

**Limits to enforce:**
- `/api/register` (when `SIGNUP_MODE=open`): 5 per IP per hour
- Review request: 20 per org per hour
- AI section drafting: 30 per user per hour, 200 per org per day
- Compliance pre-flight: 10 runs per proposal per hour
- Winner analysis: 5 runs per proposal per hour

**Verification:**
- Curl test the register endpoint 10 times rapidly → after 5, get 429
- Check Upstash/KV dashboard shows the rate-limit keys

**Effort:** 1-2 days. Most of the time is picking a backend (Upstash Redis vs Vercel KV) and wiring credentials.

**Note:** This PR also fixes the `SIGNUP_MODE=open` weakness — if you ever flip back to `open`, the rate limit is the safety net.

---

## PR-6 — Markdown sanitization + public endpoint hardening

**Scope:** P2 defense-in-depth fixes from Pass 1.

**Files:**
- `src/components/help/MarkdownRenderer.tsx` — add `skipHtml: true` to ReactMarkdown OR install `rehype-sanitize`
- `src/app/api/samgov/entity/route.ts` — add `requireAuth()` + cache responses 1 hour
- `src/app/api/proposals/[id]/pdf/[renderId]/route.ts` — add explicit `proposal.id` ownership check via the `renderId` lookup (don't just trust `proposalId`)

**Effort:** 2 hours.

---

## PR-7 — Action return-shape normalization + zod on AI JSON

**Scope:** normalize all server actions to `{ ok: true; ... } | { ok: false; error: string }`. Add zod schemas for AI JSON parsing.

**Files:**
- `src/app/(app)/companies/actions.ts:114` — `createCompanyAndGoAction` returns `Promise<void>`; change to return result
- `src/app/(app)/opportunities/[id]/ai/actions.ts:20–31` — opportunity brief uses union type; normalize
- `src/lib/ai-prompts.ts` — add zod schemas for each prompt's expected output (`CompliancePreflightVerdict[]`, `WinnerAnalysisVerdict`, `OpportunityBriefResult`, etc.)
- Use the schemas in: `compliance/actions.ts`, `winner-actions.ts`, `opportunities/[id]/ai/actions.ts`, `solicitation-extract.ts`, `ebuy-extract.ts`

**Effort:** 1 day.

---

## PR-8 — Observability via Sentry

**Scope:** integrate Sentry (free tier handles us at our scale). Wrap all `console.error` calls.

**Files:**
- `package.json` — add `@sentry/nextjs`
- `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts` — bootstrap files
- `next.config.mjs` — Sentry build wrapper
- `src/lib/log.ts` — single helper that wraps `Sentry.captureException` + `console.error`
- Sweep all `console.error` and `console.warn` calls; replace with `log.error(...)` so we get both stderr (dev) and Sentry (prod)
- Vercel env vars: `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`

**Effort:** 1 day.

---

## PR-9 — JSONB default consistency + remaining data-integrity P2s

**Scope:** fix the schema.ts JSONB defaults that use `[]` instead of `sql\`'[]'::jsonb\``. Add timestamp guard to compliance pre-flight.

**Files:**
- `src/db/schema.ts:168, 183, 916, 921, 1039` — change `.default([])` to `.default(sql\`'[]'::jsonb\`)`
- `src/app/(app)/proposals/[id]/compliance/actions.ts:421` — add `WHERE aiAssessedAt < now() - interval '5s'` guard to prevent concurrent overwrites

**Effort:** 2 hours.

---

## PR-10 — Stub-mode UX unification + env-var validation on boot

**Scope:** soften the red "stub mode" banners. Add startup validation for required env vars.

**Files:**
- `src/components/ui/StubModeBanner.tsx` — single component all stub UIs use, with consistent amber tone (not red), link to `/settings/integrations`
- Replace red banners in `OpportunityBriefPanel.tsx`, `PipelineBriefPanel.tsx`, `EbuyPasteClient.tsx`, etc. with the new component
- New helper: `src/lib/env-check.ts` — validates `DATABASE_URL`, `AUTH_SECRET` at boot; logs warnings for missing-but-optional vars
- Wire into `src/app/layout.tsx` server-side or `instrumentation.ts`

**Effort:** 4 hours.

---

## Effort summary

| PR | Effort | Blocks feature work? |
|---|---|---|
| PR-1 Multi-tenancy | 4 hrs | **YES — blocks until merged** |
| PR-2 Open redirect | 1 hr | **YES** |
| PR-3 Data integrity | 4 hrs | **YES** |
| PR-4 Indexes | 1 hr | **YES** |
| **Total blockers** | **~10 hrs / 1.5 days** | |
| PR-5 Rate limiting | 1-2 days | No — ship in parallel |
| PR-6 Markdown + endpoints | 2 hrs | No |
| PR-7 Return-shape + zod | 1 day | No |
| PR-8 Observability | 1 day | No |
| PR-9 JSONB defaults | 2 hrs | No |
| PR-10 Stub-mode + boot env | 4 hrs | No |
| **Total non-blockers** | **~3.5 days** | |
| **Total audit fixes** | **~5 days** | |

After this work, the foundation is solid enough to take on the broader Chapter 16+ vision (nav restructure → collaborative editor → billing → tenant administration). Without it, every new feature compounds the risk surface.
