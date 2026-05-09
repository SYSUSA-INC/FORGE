# FORGE — Operations & Release Engineering

This document covers how code gets from a developer's branch to production
**without taking the site down**. Written after we shipped four production
hotfixes in succession because we lacked: (a) a CI gate that runs `next build`
on every PR, (b) a staging environment to verify changes before they hit the
production domain.

There are two deployment-safety mechanisms in place:

1. **CI gates on every PR** — GitHub Actions runs typecheck, build, RSC
   boundary check, and fresh-DB migration verification. A PR cannot merge to
   `main` until all four are green.
2. **Staging environment** — every PR (and `main`) deploys to a Vercel
   preview backed by a Neon staging branch. You manually smoke-test before
   merging.

---

## CI gates (Phase 1)

The workflow file: `.github/workflows/pr.yml`. Four required checks:

| Job              | What it catches                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| `typecheck`      | TypeScript errors (missing types, bad signatures, etc.)                                          |
| `build`          | **Next build failures including RSC boundary bugs**. This is what would have caught PR #115's bug. |
| `rsc-boundaries` | Server components importing non-component named exports from `"use client"` files                |
| `migrations-fresh` | Migrations applied to an empty Postgres + idempotency on re-run                                  |

### Why each one exists

**`build` is the most important.** When PR #115 introduced an RSC boundary bug,
`next build` would have caught it locally — but no one ran it. Production
crashed with `TypeError: n is not a function` until we shipped four band-aids.
Going forward: if `next build` fails, you cannot merge.

**`rsc-boundaries`** is a static double-check. `next build` catches the bug
when it runs, but builds can be slow. The static checker is fast (<1s) and
gives a clearer error message pointing at the specific file and import.

**`migrations-fresh`** catches the class of bugs where a migration depends on
state from a prior migration that has been edited. Passes on a developer's
already-migrated DB; breaks production. We boot a clean Postgres, replay every
migration, then run them again to verify idempotency.

### Running locally before pushing

```bash
npm run check:all       # typecheck + RSC + build
npm run check:rsc       # just the RSC boundary check (fast)
npm run check:migrations  # needs DATABASE_URL pointing at a throwaway DB
```

`check:all` is what you should run before opening a PR. If it fails locally,
it will fail in CI.

### Branch protection — required setup in GitHub

Once the workflow runs once on a PR, configure branch protection on `main` to
require these checks. **The CI workflow alone does not block merges; branch
protection does.** Steps:

1. Open the repo on GitHub → **Settings** → **Branches**
2. Under "Branch protection rules", click **Add rule** (or edit the existing
   `main` rule)
3. Branch name pattern: `main`
4. Enable:
   - ✅ **Require a pull request before merging**
   - ✅ **Require status checks to pass before merging**
     - ✅ **Require branches to be up to date before merging**
     - In the search box, add each check by name:
       - `Type check`
       - `Next build`
       - `RSC boundary check`
       - `Fresh-DB migration verification`
   - ✅ **Require conversation resolution before merging**
   - ✅ **Do not allow bypassing the above settings** (applies to admins too)
5. Save

After this, no PR can merge to `main` unless all four checks are green.

---

## Staging environment (Phase 2)

Goal: every PR lands on a real, isolated, internet-reachable URL with a real
Postgres. You click through it before merging. Production stays untouched
until merge.

This requires one-time setup that **the human operator** must perform — Claude
cannot provision Vercel projects or Neon branches via API.

### One-time provisioning (operator action required)

#### A. Neon staging branch

1. Sign in to [Neon Console](https://console.neon.tech/)
2. Open the FORGE project
3. Click **Branches** → **Create branch**
4. Name: `staging`
5. Parent: `main` (or whichever branch holds production data)
6. Choose: **Branch from latest data** (so staging starts with a snapshot of
   prod). Schedule periodic refreshes if you want staging to track prod over
   time.
7. Copy the staging branch's connection string. Keep it secret; you'll paste
   it into Vercel below.

> **Note on data**: staging uses a copy of production data. Before doing
> anything destructive on staging (e.g. testing a delete flow), be aware
> the data is real customer data. Do not email real customers from staging.
> See "Email isolation" below.

#### B. Vercel preview environments + staging Postgres

You don't need a separate Vercel project — Vercel's built-in preview
environments work. The trick is using **per-environment env vars** so previews
point at staging Postgres instead of production Postgres.

1. Open the FORGE project on Vercel
2. **Settings** → **Environment Variables**
3. For each of these vars, set the **Preview** value to the staging value
   (do NOT change the Production value):
   - `DATABASE_URL` → staging Neon connection string from step A
   - `AUTH_URL` / `NEXT_PUBLIC_APP_URL` → leave **unset** on Preview. See
     step 4 for how the app handles this without them.
   - `RESEND_API_KEY` → if you want preview emails, point at a Resend
     sandbox / test domain. Otherwise unset — `src/lib/email.ts` no-ops
     when the key is missing (logs the send, returns).
   - All other secrets: copy production values to Preview unless you have
     a reason not to.
4. How preview URLs work without `AUTH_URL` set:
   - **OAuth callbacks (NextAuth v5):** `src/auth.config.ts` sets
     `trustHost: true`, so NextAuth derives the callback host from
     request headers (Vercel sets `X-Forwarded-Host` to the preview
     hostname). OAuth round-trips therefore resolve to the preview URL
     automatically.
   - **Email links:** `baseUrl()` in `src/lib/email.ts` resolves to
     `https://${VERCEL_URL}` on preview deploys (Vercel sets `VERCEL_URL`
     to the preview hostname automatically), to `https://www.sysgov.com`
     when `VERCEL_ENV === "production"`, or to `NEXT_PUBLIC_APP_URL` /
     `AUTH_URL` if either is explicitly set.

#### C. Wire branch protection to wait on Vercel

Optional but recommended. Vercel posts a `vercel` status check to GitHub when
a preview build starts and updates it to success on deploy. Add `vercel` to
the list of required checks in branch protection (step from "Branch
protection" above) so a PR cannot merge until the preview has actually
deployed successfully.

### Day-to-day workflow

```
1. Open PR
   → CI runs (4 gates above)
   → Vercel deploys to preview URL (visible on PR)

2. CI green + preview live
   → Click the preview URL in the PR
   → Smoke-test the feature you changed
   → Run the smoke checklist below

3. All clear
   → Merge to main
   → Vercel auto-deploys main to production
```

### Smoke-test checklist (run on the preview URL)

Don't merge until you've manually run through this. Copy/paste it into the
PR description and check it off.

```markdown
## Pre-merge smoke (run on Vercel preview URL)

- [ ] Sign-in page loads
- [ ] Sign in succeeds with my account
- [ ] /opportunities loads (the page that crashed in PR #115)
- [ ] Command Center / home loads
- [ ] The specific feature this PR changed: works as expected
- [ ] Open browser devtools → Console: no red errors
- [ ] Open Network tab: no 500s on initial page load

## If this PR touches the DB:
- [ ] Visited /admin/migrations on staging → all green
- [ ] Created/edited/deleted a record in the affected table → no errors
```

### Email isolation in staging

By default, **Resend is unset on Preview** so all email sends become no-ops.
This protects against staging accidentally emailing real customers.

If you want preview deploys to actually send mail (e.g. testing the
notifications system), set `RESEND_API_KEY` to a test-domain key on Preview
and verify all `to:` addresses are routed to your own inbox first.

### Refreshing staging data

To pick up the latest production data on the staging Neon branch:

1. Neon Console → Branches → `staging` → **Reset branch from parent**
2. This drops staging's diverged state and re-snapshots from main
3. Re-apply any staging-only test data you need

Schedule a weekly reset if staging starts drifting too far from prod.

---

## What to do when production breaks

1. Check Vercel **Deployments** → did a deploy just complete? If so:
   - **Don't immediately revert.** Read the runtime logs. The error often
     points at the actual cause faster than reverting + investigating.
   - If logs show a clear regression introduced by the latest deploy:
     **Vercel → Deployments → previous successful deploy → Promote to
     Production**. Faster than git revert + redeploy.
2. If production has been broken for >5 minutes and the cause isn't obvious,
   promote the last known-good deploy and investigate offline.
3. **Do not push hotfixes to `main` without going through CI + preview.**
   That's how we ended up here. The CI runs in <5 minutes; promote-previous
   buys you that time.

---

## File layout (where to look)

```
.github/workflows/pr.yml         CI gate definitions
scripts/check-rsc-boundaries.mjs Static RSC boundary check
scripts/check-migrations-fresh.mjs   Fresh-DB migration verification
scripts/apply-schema.mjs         Migration applier (used by check-migrations-fresh and /admin/migrations)
src/lib/migration-runner.ts      Runtime migration runner (admin-triggered)
src/app/(app)/admin/migrations/  Admin UI to apply pending migrations
docs/OPERATIONS.md               This file
```
