# FORGE handoff — 2026-04-24

## Environment
- **Repo:** `SYSUSA-INC/forge` (GitHub MCP restricted to this repo)
- **Production:** https://www.sysgov.com (Vercel custom domain — auto-deploys on merge to main)
- **Database:** Neon Postgres → `DATABASE_URL` (pooled) set in Vercel env + `.env.local` in Codespaces
- **ORM:** Drizzle + `pg` Pool (NOT `drizzle-orm/neon-http` — that lacks transaction support)
- **Project root:** `/home/user/FORGE` (sandbox), `/workspaces/FORGE` (Codespaces)
- **Node:** 22 on sandbox, 22/24 on Codespaces
- **Git push:** Works normally now; previous 503 sandbox issue resolved

## Critical operational rules (learned the hard way)

1. **NEVER use `drizzle-kit migrate`** — it hangs indefinitely against Neon's pooled connection. Use `node scripts/apply-schema.mjs` instead. It's idempotent (skips already-applied) and works every time.
2. **NEVER use `db.transaction()`** — Neon's PgBouncer-in-transaction-mode pooler breaks it unpredictably. Use sequential inserts with manual `await db.delete(...).catch(() => undefined)` rollback, like the pattern in `src/app/api/register/route.ts` → `provisionUserAndOrg`.
3. **Run migrations BEFORE merging schema PRs** — if you merge first, production serves new code against an old schema → `relation "..." does not exist` errors. User workflow: `git fetch origin && git checkout <branch> && node scripts/apply-schema.mjs` → paste output → then merge.
4. **.env.local URLs must be double-quoted** — `source .env.local` in bash mangles unquoted URLs containing `&`. The `drizzle.config.ts` loads it via `dotenv` to work around this, but manual terminal `source` still breaks.
5. **Migration order:** whenever you add a schema change, generate with `npx drizzle-kit generate --name <desc>` on sandbox, commit the `drizzle/` artifacts, ask user to run `apply-schema.mjs`.

## What's merged to main (phase-by-phase)

| PR | Scope |
|---|---|
| #9 | Phase 1b — aurora `/settings` UI (localStorage) |
| #10-11 | Phase 2a — Neon schema + drizzle env loader fix |
| #12-14 | Phase 2b/.1/.2 — GitHub OAuth (deprecated), email/password auth, tenancy foundation (auto-org + session with `organizationId`/`role`/`isSuperadmin`) |
| #15 | Register transaction → sequential inserts fix |
| #16 | Route groups: `(app)` vs `(auth)` so auth pages don't render AppShell |
| #17 | `scripts/apply-schema.mjs` + `scripts/grant-superadmin.mjs` |
| #18 | Email baseURL + solid-button fix (sysgov.com in prod, not `vercel.app`) |
| #19 | Phase 2b.3 — data firewall, `/settings` on Neon, `rowToOrgProfile` mapping |
| #20-21 | Validators (email/phone/UEI/CAGE/DUNS/ZIP/state/NAICS) with phone tightening |
| #22 | Phase 2b.4 — `/users` admin UI + invite flow via `allowlist` + Resend |
| #23 | Phase 2b.5 — SuperAdmin portal at `/admin` (orgs tab + platform users tab) + `disabled_at` on user/organization |
| #24 | Phase 2b.6 — Google + Microsoft SSO + GitHub removed from UI (provider kept) + `events.createUser`/`events.signIn` auto-provisioning |
| #25 | Phase 3a — `/opportunities` list/new/detail with 10-stage enum |
| #26 | Phase 3b — `/opportunities/[id]` tabbed: evaluation (5-dim scorecard + gate decision), competitors, activity |
| #27 | Phase 4a — `/proposals` with 10-stage lifecycle + 6 default sections (Exec Summary / Technical / Management / Past Perf / Pricing / Compliance) |
| #28 | SAM.gov opportunity search + bulk import at `/opportunities/import` |
| #29 | Phase N1 — `/companies` with SAM.gov entity search; `company_relationship` enum |
| #30 | Phase 4b — color-team review workflow (proposal_review / assignment / comment tables) |

## Open PRs (needs action)

### PR #31 — Phase 4c Compliance matrix
- **Status:** build green, NOT merged
- **Blocker:** user needs to run `node scripts/apply-schema.mjs` in Codespaces on branch `claude/phase-4c-compliance` to apply migration `0010_add_compliance_table` (creates `compliance_item` table + `compliance_category`/`compliance_status` enums)
- **After migration:** merge immediately

### PR #32 — User + Admin manuals (CURRENT WIP)
- **Status:** draft/open, build green, NOT merged
- **Branch:** `claude/docs-manuals`
- **What's there now:** `docs/USER_MANUAL.md` (~1500 words), `docs/ADMIN_MANUAL.md` (~1000 words), `docs/README.md`, `docs/images/README.md`, `react-markdown` + `remark-gfm` deps installed
- **User's latest direction (must address):**
  1. **Format:** in-app pages at `/help/user` and `/help/admin` that render the same markdown (alongside the files in `docs/`)
  2. **Audience split:** two separate files, cross-reference where they overlap
  3. **Depth:** medium — feature-by-feature, **2000-3000 words each** (current drafts are too short)
  4. **Focus:** FORGE-specific, emphasize **roles and responsibilities clearly defined and auditable** — not GRC concepts (user is building a separate GRC product)

### What to ship in PR 32 (remaining work)
- Expand `USER_MANUAL.md` to ~2500 words. Add a **Roles matrix** section showing what each role (admin/capture/proposal/author/reviewer/pricing/viewer) can do. Expand every feature walkthrough. Emphasize audit trails (activity timeline, review history, compliance history, stage change log).
- Expand `ADMIN_MANUAL.md` to ~2500 words. Deepen the org admin and superadmin workflows. Add an "Audit & accountability" section covering where changes are recorded (activity log on opportunities, review verdicts history, stage-change entries, `created_by_user_id` / `updated_at` on every table).
- Create in-app `/help` routes:
  - `src/app/(app)/help/layout.tsx` — shared layout with tab links (User guide / Admin guide — Admin visible only to org admins + superadmins)
  - `src/app/(app)/help/page.tsx` — redirect to `/help/user`
  - `src/app/(app)/help/user/page.tsx` — `fs.readFileSync('docs/USER_MANUAL.md')` + `react-markdown` + `remark-gfm`
  - `src/app/(app)/help/admin/page.tsx` — same pattern, guarded by a check like `user.role === 'admin' || user.isSuperadmin`
  - Shared `src/components/help/MarkdownRenderer.tsx` — renders with aurora-themed prose styling (Tailwind `prose` utility classes + dark-theme overrides)
- Add "Help" nav entry (all users see it; routes to `/help/user`)
- Commit, push to `claude/docs-manuals`, update PR 32 body, wait for user to test, merge

## After PR 32 merges
Remaining roadmap:
- **Phase 5** — Proposal Output: Win/Loss + Debrief (user explicitly asked for this; original roadmap phase)
- **AI gateway** — `src/lib/ai.ts` (Bedrock / Azure / vLLM switchable) + populate `/intelligence` page. Deferred from day 1.

## User context
- **Name:** Muneer Baig
- **Email:** muneer.baig@sysusa.com
- **Role:** Superadmin (granted via `scripts/grant-superadmin.mjs`)
- **Org:** Auto-created "Muneer Baig's Workspace" on his first signup
- **Works from:** GitHub Codespaces (browser-based VS Code). Prefers terminal commands pasted as a block.
- **Ops preferences:**
  - Push then merge (don't sit on open PRs)
  - Drafts OK for work-in-progress; user confirms + I flip to ready + merge
  - No narration between tool calls when shipping — just go

## Env vars set on Vercel (known)
- `DATABASE_URL` (pooled Neon)
- `SAMGOV_API_KEY`
- `RESEND_API_KEY`, `EMAIL_FROM` ("Forge <noreply@sysgov.com>")
- `AUTH_SECRET` = `hOAX+fCrRZVTsso6NjOo5mx8lXZYnmlU1AFBrguvBAE=`
- `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (provider removed from UI in #24 but env vars still present — safe to delete from Vercel)
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` — **user never confirmed setup; probably not live**
- `AUTH_MICROSOFT_ENTRA_ID_ID` / `_SECRET` / `_ISSUER` — **user never confirmed setup; probably not live**

SSO buttons render in UI but 500 until Google/Microsoft env vars are actually added. Email/password + invites work fine regardless.

## Key files to know (quick map)

```
src/
├── db/
│   ├── schema.ts           # All tables + enums. Grows each migration.
│   └── index.ts            # pg Pool + drizzle client
├── auth.ts                 # NextAuth v5 + Credentials + Google + Microsoft + events
├── auth.config.ts          # Edge-safe config (no DB, no adapter)
├── middleware.ts           # Route protection
├── lib/
│   ├── auth-helpers.ts     # requireAuth / requireCurrentOrg / requireOrgAdmin / requireSuperadmin
│   ├── validators.ts       # Field validators (email/phone/UEI/...)
│   ├── samgov.ts           # SAM.gov Entity + Opportunity API wrappers
│   ├── email.ts            # Resend templates + sendInviteEmail etc.
│   ├── tokens.ts           # verificationToken helpers (issue/consume, 3 purposes)
│   └── *-types.ts          # Per-domain: org, opportunity, proposal, review, compliance, company
├── app/
│   ├── (auth)/             # sign-in, sign-up, verify-email, forgot/reset-password
│   ├── (app)/              # Everything behind AppShell
│   │   ├── settings/       # Org profile
│   │   ├── opportunities/  # List + new + [id]/* + import/
│   │   ├── proposals/      # List + new + [id]/* (overview/sections/reviews/compliance)
│   │   ├── companies/      # List + search + new + [id]
│   │   ├── users/          # Org admin user mgmt
│   │   ├── admin/          # Superadmin portal
│   │   └── help/           # TO BUILD IN PR 32
│   └── api/auth/[...nextauth]/route.ts
└── components/shell/       # AppShell / NavContent / MobileNav / SideNav
scripts/
├── apply-schema.mjs        # THE migration runner
└── grant-superadmin.mjs    # First-superadmin bootstrap
drizzle/                    # Generated SQL migrations (0000–0010)
docs/
├── USER_MANUAL.md          # EXPAND in PR 32
├── ADMIN_MANUAL.md         # EXPAND in PR 32
├── README.md
└── images/README.md        # User drops PNGs here later
```

## First message to the next session

> Resume from the handoff block above. You're on branch `claude/docs-manuals`. Finish PR #32 per the user's spec: expand both manuals to ~2500 words each emphasizing roles/responsibilities and auditability (FORGE-specific — no GRC terms), then add in-app `/help/user` and `/help/admin` pages rendering the markdown via react-markdown. Add a Help nav entry. Also nudge the user to apply migration 0010 for PR #31 (Phase 4c compliance matrix) so it can merge.
