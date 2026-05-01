# FORGE — Consolidated Backlog

Single source of truth for the active build. Updated 2026-04-30.

This file replaces the per-branch `backlog1.md` … `backlog5.md` handoff notes. When a session ends, update this file in `main` so the next session starts here, not from chat scrollback.

---

## 1. Live state at a glance

- **Repo:** `SYSUSA-INC/forge`
- **Production:** https://www.sysgov.com (Vercel, auto-deploys `main`)
- **DB:** Neon Postgres + pgvector, Drizzle ORM via `pg` Pool
- **Auth:** NextAuth v5 (Credentials + Google + Microsoft + GitHub)
- **Editor:** TipTap (StarterKit + Underline + Link + Image + Table + Placeholder)
- **AI gateway:** `src/lib/ai.ts`, default `claude-sonnet-4-6`
- **Embeddings:** OpenAI `text-embedding-3-small` (1536-dim) — required for Phase 10d/e/f
- **PDF:** Browserless (HTML→PDF), CloudConvert (DOCX→PDF)

## 2. Open work

### 2a. Tier 3 — Brain stack (merge top-down with rebases between each)

| PR | Phase | Status | Migration |
|---|---|---|---|
| #54 | 10b — knowledge corpus uploader | open, draft, **next merge target** | 0018 |
| #60 | 10c — Brain extraction | open, draft, depends on #54 | 0021 |
| #61 | 10d — pgvector embeddings + semantic search | open, draft, depends on #60 | 0022 (enables `pgvector`) |
| #62 | 10e — Brain Suggest in editor | open, draft, depends on #61 | — |
| #63 | 10f — harvest submitted proposals + entry embeddings | open, draft, depends on #62 | 0023 |
| #66 | UI — "Embed missing entries" button | open, draft, depends on #63 | — |

### 2b. Independent open PRs

| PR | Phase | Notes |
|---|---|---|
| #67 | 10g — vision OCR for corpus images | currently based on #60; needs rebase to `main` once Tier 3 lands |
| #68 | 13b — USAspending past-performance import | independent; can merge any time |

### 2c. WIP branches not yet PR'd

- `claude/phase-13c-oauth-email-google` — OAuth email-from-sender (Google only). Has schema + migration **0025** + `src/lib/email-oauth.ts` (AES-256-GCM encryption + token refresh + Gmail send). **Missing:** `/api/email-oauth/google/*` routes, `/settings/email` UI, wire into `sendOpportunityReviewRequestEmail`.

### 2d. Stale PRs (closed)

- ~~PR #7~~ inverted base; closed 2026-04-30.
- ~~PR #8~~ superseded by PR #9 + #19; closed 2026-04-30.

## 3. Owed-by-user (gating progress)

1. **Diagnose failing Vercel deployment.** Almost certainly caused by merged code referencing tables in unrun migrations (#56 references `opportunity_review_requests`, #65 references `solicitation_assignments`).
2. **Run migrations on Neon SQL Editor** (or `node scripts/apply-schema.mjs` from Codespaces). All three are idempotent and discovered by filename:
   - `drizzle/0019_add_opportunity_review_requests.sql`
   - `drizzle/0020_add_docx_template_kind.sql`
   - `drizzle/0024_add_solicitation_assignments.sql`
3. **Set Vercel env vars** as features come online:
   - `OPENAI_API_KEY` — gates Phase 10d/e/f embeddings
   - `CLOUDCONVERT_API_KEY` — used by PR #64 (already merged)
   - `EMAIL_ENCRYPTION_KEY` — `openssl rand -hex 32`, for Phase 13c OAuth email
   - `GOOGLE_EMAIL_CLIENT_ID` / `GOOGLE_EMAIL_CLIENT_SECRET` — Phase 13c (can reuse existing Google OAuth creds with added Gmail scopes)

## 4. Migration ledger

Sequence on disk after recent merges: `0000`–`0015`, `0017`, `0019`, `0020`, `0024`. **`0016` was never created** — renumbering during a rebase, not a missing file. `apply-schema.mjs` discovers files by filename glob and skips already-applied statements, so the gap is harmless.

| Mig | Source PR | Applied to prod? |
|---|---|---|
| 0000–0015 | #10–#33 | yes |
| 0017 | #48 (Phase 8) | yes |
| 0019 | #56 (Phase 11b) | **NO — apply now** |
| 0020 | #57 (Phase 12a) | **NO — apply now** |
| 0024 | #65 (Phase 13a) | **NO — apply now** |
| 0018 | #54 — pending merge | n/a |
| 0021 | #60 — pending merge | n/a |
| 0022 | #61 — pending merge (enables `pgvector`) | n/a |
| 0023 | #63 — pending merge | n/a |
| 0025 | WIP `phase-13c-oauth-email-google` | n/a |

## 5. Roadmap (not yet started)

- **Chapter 14 — Autonomous proposal intelligence:**
  - 14a outcome-aware Brain
  - 14b section-level signals
  - 14c compliance pre-flight
  - 14d pattern-guided drafter
  - 14e auto-draft full proposal
  - 14f proposal-vs-winner scoring

- **SBIR/STTR opportunity integration** — pull federal Small Business
  Innovation Research and Small Business Technology Transfer
  solicitations and awards alongside the existing SAM.gov +
  USAspending sources. Realistic data sources:
  - **SBIR.gov public API** (`https://www.sbir.gov/api`) — exposes
    open solicitations, closed solicitations, and awarded contracts.
    No auth, similar shape to the USAspending pattern we already use.
  - **DSIP (DoD SBIR/STTR Innovation Portal)** — DoD-specific
    solicitations (Air Force, Army, Navy, etc.). Separate site, may
    need scraping or a manual paste flow like the eBuy ingester.
  - **SAM.gov notice types** — SBIR/STTR opportunities also surface
    in SAM.gov under specific notice-type codes; we already have the
    SAM.gov client wired and could just add an "SBIR/STTR" filter
    pill to the existing importer at `/opportunities/import`.

  Suggested first slice (one PR): mirror the USAspending pattern.
  Build `src/lib/sbir.ts` (search by topic / agency / phase + keyword),
  add `searchSbirOpportunitiesAction` + `importSbirOpportunitiesAction`,
  ship `/opportunities/sbir` page with multi-select import, idempotent
  on the SBIR topic code via tags. Future slices: DSIP scraper, awards
  → past-performance import, eligibility pre-check from org profile
  (small-business / 8(a) / SDVOSB filters).

- **Phase 13c v2** — Microsoft Graph for OAuth email-from-sender
  (the schema enum already accepts `microsoft` but the helper is not
  built). Lower priority now that the platform-brand From + Reply-To
  approach (PR #74) covers the main goal.

## 6. Conventions (do not violate without explicit permission)

- **Never** use `db.transaction()` on Neon (PgBouncer transaction-mode breaks it). Use sequential inserts with manual `.catch(() => undefined)` rollback — see `provisionUserAndOrg` in `src/app/api/register/route.ts`.
- **Never** use `drizzle-kit migrate` against Neon — it hangs on the pooled connection. Use `npm run db:apply` or paste SQL into the Neon SQL Editor.
- When adding a `notification_kind` enum value: also update `src/lib/notification-types.ts` (label + icon + color). Conflicts have happened twice when stacked PRs both added a kind.
- **Stub-mode pattern:** every external dependency (AI, embeddings, PDF, storage, OAuth) falls back to a deterministic stub when its env var is missing, so dev and preview work without credentials. UI banners surface stub mode in red/amber so it's never confused with live output.
- One `in_progress` task at a time in the todo list.

## 7. Stacked-PR rebase pattern (what's working)

GitHub squash-merges the lead PR cleanly, but every downstream PR collides because (a) squash produces a new commit SHA, (b) sibling PRs both add enum values to the same Drizzle file, and (c) `package.json` / `package-lock.json` collide when stacks add different deps. The pattern that works:

```bash
# After the lead PR merges:
git fetch origin main
git checkout <next-branch>
git pull --rebase origin main
# Resolve schema enum + notification-types.ts conflicts.
# For package.json conflicts: keep both sets of deps, then:
npm install --package-lock-only
git add . && git rebase --continue
git push --force-with-lease origin <next-branch>
# Then merge via GitHub MCP (squash).
```

## 8. File map (bookmark these)

```
src/
  db/
    schema.ts              # source of truth for tables + enums
    index.ts               # pg Pool + drizzle client
  auth.ts                  # NextAuth v5 + providers + events
  middleware.ts            # route protection
  lib/
    ai.ts                  # AI gateway
    ai-prompts.ts          # prompt templates
    embeddings.ts          # OpenAI embeddings client
    text-chunk.ts          # chunking for embeddings
    email.ts               # Resend (transactional)
    email-oauth.ts         # OAuth email send (WIP branch only)
    notification-types.ts  # label/icon/color per kind — update with each enum addition
    auth-helpers.ts        # requireAuth / requireCurrentOrg / requireOrgAdmin / requireSuperadmin
    validators.ts          # email/phone/UEI/CAGE/DUNS/ZIP/state/NAICS
    samgov.ts              # SAM.gov Entity + Opportunity API wrappers
    tokens.ts              # verificationToken issue/consume
  app/
    (auth)/                # sign-in, sign-up, verify-email, forgot/reset-password
    (app)/                 # everything behind AppShell
      settings/            # org profile
      opportunities/       # list + new + [id]/* + import/
      proposals/           # list + new + [id]/* (overview/sections/reviews/compliance)
      companies/
      users/               # org admin user mgmt
      admin/               # superadmin portal
      help/                # /help/user + /help/admin (markdown rendered)
      solicitations/
      knowledge-base/
      intelligence/
scripts/
  apply-schema.mjs         # idempotent migration runner — picks up SQL files by filename
  grant-superadmin.mjs
  db-info.mjs
drizzle/                   # SQL migrations (see §4)
docs/
  USER_MANUAL.md
  ADMIN_MANUAL.md
```

## 9. How to update this file

When you start or end a session that changes the live state:

1. Update §2 (open PRs) and §2c (WIP branches) to match reality.
2. Move applied migrations from §4 "NO" to "yes".
3. Move shipped roadmap items out of §5 into the merged-PR list (or just delete — `git log` is the canonical record).
4. Commit on a working branch, open a PR, merge to `main` so the next session starts from truth.
