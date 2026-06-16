# FORGE — Environment Separation

**Status:** Target state. Setup is one-time and takes ~2 hours.
**Priority:** P0 — must be done before the first paying customer onboards.
**Last updated:** 2026-06-16

This document is the operator runbook for separating **development**, **staging**, and **production** so that production customer data is **never** touched by ordinary development activity.

---

## 1. Current state (today)

```
Local dev   → developer's machine, hits a Neon dev branch
PR previews → Vercel preview env, each PR gets its own Neon branch
main        → Vercel production project, shared Neon main branch
```

**The problem:** "Vercel production project" and "shared Neon main branch" are the same things real customers will use. There is no firewall between "I'm testing a new feature in main" and "customer data."

Before customers land, we need three environments with hard separation.

---

## 2. Target state

```
┌──────────────────────────────────────────────────────────────────────┐
│ DEV (each developer's laptop)                                        │
│   - Code: feature branch                                              │
│   - Data: Neon dev branch (per developer or per PR)                   │
│   - Domain: localhost                                                 │
│   - Reset: weekly, disposable                                         │
└──────────────────────────────────────────────────────────────────────┘
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ STAGING                                                               │
│   - Code: `main` branch                                               │
│   - Data: Neon **staging project** (separate from prod!)              │
│   - Domain: staging.forge.app                                         │
│   - Real customers: NONE — synthetic data only                        │
│   - Auto-deploys on every merge to main                               │
└──────────────────────────────────────────────────────────────────────┘
                                ▼
                       (manual approval gate)
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│ PRODUCTION                                                            │
│   - Code: `release` branch                                            │
│   - Data: Neon **prod project** (completely isolated)                 │
│   - Domain: app.forge.app                                             │
│   - Real customers: YES                                               │
│   - Deploys: manual approval required (see PRODUCTION_DEPLOY_GATE.md) │
└──────────────────────────────────────────────────────────────────────┘
```

Key principle: **Neon project separation, not just branch separation.** A Neon branch is good for ephemeral dev/test work, but the prod data should live in a separate Neon **project** with its own billing, its own access controls, its own connection limits, and its own PITR window.

---

## 3. Why "separate Neon project" matters

Neon branches share a parent project's compute, storage, and connection pool. A bad query on a dev branch can degrade prod performance. A point-in-time restore on the parent branch can affect children.

Two separate Neon projects = two completely isolated databases:
- Separate billing (you can see exactly what prod costs)
- Separate access controls (dev team only has access to dev/staging project)
- Separate connection limits (a dev runaway can't exhaust prod connections)
- Separate PITR windows (prod can be on a longer retention plan)

The cost difference: minimal. Neon Pro projects start at $19/mo; the second project is the same. We pay ~$40/mo for two projects vs ~$20/mo for one.

**This is a no-brainer once we have customer data.**

---

## 4. Setup — Step by step (~2 hours)

### Step 1: Create the prod Neon project (15 min)

1. https://console.neon.tech → **New project**
2. Name: `forge-prod`
3. Region: same as current prod (us-east-2 or wherever the current main branch lives)
4. Plan: **Pro** (we need PITR + multiple compute scale)
5. Default branch name: `main`
6. Copy the connection string somewhere safe — this becomes `DATABASE_URL` for production

### Step 2: Migrate the current Neon project to be staging (15 min)

1. In Neon, rename the existing FORGE project from whatever it's called → `forge-staging`
2. This is just a relabel; no data moves

### Step 3: Apply all migrations to the new prod project (10 min)

The prod project starts empty. Run all migrations:

```sh
DATABASE_URL='<new prod connection string>' npx drizzle-kit push
```

Or rely on auto-apply: deploy the prod Vercel project (next step) and let migrations run on cold start.

### Step 4: Create the second Vercel project (15 min)

The existing FORGE Vercel project becomes **prod**. We create a NEW one for staging.

1. https://vercel.com → **New Project** → import sysusa-inc/forge
2. Name: `forge-staging`
3. Production branch: `main`
4. Custom domain: `staging.forge.app` (set this up at the registrar first)
5. Env vars (copy from prod, change a few):
   - `DATABASE_URL`: connection string for **staging Neon project** (the relabeled original)
   - `NEXT_PUBLIC_APP_URL`: `https://staging.forge.app`
   - `VERCEL_ENV`: `staging`
   - All other secrets: copy from prod
6. Deploy

### Step 5: Reconfigure the original Vercel project (10 min)

The existing FORGE Vercel project keeps `app.forge.app` but now becomes the prod environment with the new prod Neon DB.

1. Vercel → existing FORGE project → Settings → Git
2. Change **Production Branch**: `main` → `release`
3. Update env vars:
   - `DATABASE_URL`: connection string for **new prod Neon project**
   - `NEXT_PUBLIC_APP_URL`: `https://app.forge.app`
   - All other secrets stay the same (we may want fresh prod-only secrets — see step 8)
4. Save

### Step 6: Create the `release` branch (5 min)

```sh
git checkout main
git pull
git checkout -b release
git push -u origin release
```

### Step 7: Set up the GitHub environment protection rule (15 min)

Follow `docs/PRODUCTION_DEPLOY_GATE.md`.

### Step 8: Rotate prod secrets (30 min)

This is the moment to use fresh secrets for prod that have never been on staging. Even though we share the same NextAuth flow, having a separate prod `AUTH_SECRET` means a leaked staging secret cannot decrypt prod tokens.

Follow `docs/SECRETS_ROTATION.md` for each of these on the prod Vercel project ONLY:
- `AUTH_SECRET` — fresh value
- `CRON_SECRET` — fresh value
- `RESEND_API_KEY` — fresh API key (request a new one from Resend)
- `ANTHROPIC_API_KEY` — fresh API key

Staging keeps the old keys for now; we rotate quarterly per `docs/SECRETS_ROTATION.md`.

### Step 9: Smoke test (15 min)

1. Visit `staging.forge.app` — should load fine, using staging data
2. Visit `app.forge.app` — should load fine, using empty prod data
3. Try to sign up on prod — verify it lands in the **prod Neon project**, not staging
4. Try to sign up on staging — verify it lands in the **staging Neon project**, not prod
5. Cross-check: query both Neon projects' `user` table — confirm the new test users are in the right one

### Step 10: Add env-validation guards in code (next PR)

Code-level defense-in-depth — a future PR will:
- Validate `VERCEL_ENV` against `DATABASE_URL` host pattern at boot. If `VERCEL_ENV=production` but `DATABASE_URL` points at the staging host, crash with a loud error.
- Render a non-prod banner when `VERCEL_ENV !== "production"` so developers can never confuse the two during testing.
- Block destructive admin actions in `VERCEL_ENV=staging` from being run against prod data.

---

## 5. Day-to-day developer workflow (after setup)

### Local development

```sh
# Pull a fresh Neon dev branch from the staging project
neon branches create --project staging-project-id --name "$(whoami)-dev"

# Get the connection string
export DATABASE_URL="postgres://..."

# Run locally
npm run dev
```

Optionally, every developer has their own personal Neon branch under the staging project. Reset weekly.

### PR previews

Vercel automatically creates a preview deploy for every PR. Configured to use a per-PR Neon branch (via Vercel + Neon's preview integration).

### Promoting to staging

Merge PR → `main`. Auto-deploys to `staging.forge.app`. CI re-runs full gates.

### Promoting to production

Open a PR `main` → `release`. CI re-runs. Founder approves. Deploy fires.

---

## 6. Data flow rules

These rules are not enforced by code yet — they are operational discipline until we add code guards (next PR).

### NEVER

- ❌ Copy prod data into staging (defeats the purpose of separation, and if a real customer is in prod, copies into staging may expose their data inappropriately)
- ❌ Connect a local dev environment to the prod Neon project. Ever. Even for a "quick query."
- ❌ Run a script with `DATABASE_URL=<prod>` on a laptop. Use Neon's read-replica or Neon SQL Editor instead.
- ❌ Deploy code from a branch other than `release` to the prod Vercel project.

### ALWAYS

- ✅ Develop against the staging Neon project (your own branch under it).
- ✅ Smoke-test on `staging.forge.app` before promoting to prod.
- ✅ Take a Neon snapshot of prod before manually running any destructive operation (the `NEON_API_KEY` auto-snapshot covers migrations; manual ops need manual snapshots).

---

## 7. Disaster recovery

| Scenario | Recovery time | Data loss |
|---|---|---|
| Bad code deployed to prod | ~3 min (one-click Vercel rollback) | none |
| Bad migration to prod | ~10 min (Neon PITR to pre-migration timestamp) | edits since migration ran |
| Prod Neon project corrupted | ~30 min (restore from PITR to a new branch, swap connection string) | minimal (PITR covers 7-30 days) |
| Prod Neon project deleted | ~hours (restore from the most recent automated backup) | up to 24 hours |
| Vercel-wide outage | hours-to-days | none (data is safe in Neon) |
| Neon-wide outage | hours-to-days | depends on PITR availability |
| Both Vercel and Neon down simultaneously | hours (rare) | depends |

For the last two scenarios, we have no good answer today. **AWS migration is the long-term answer** (`docs/architecture/aws-deployment-roadmap.md`), but those are tail-risk events that don't justify pre-revenue spend.

---

## 8. Cost impact

| Line item | Before | After | Delta |
|---|---|---|---|
| Vercel projects | 1 × $20 = $20/mo | 2 × $20 = $40/mo | +$20/mo |
| Neon projects | 1 × $19 = $19/mo | 2 × $19 = $38/mo | +$19/mo |
| **Total** | **$39/mo** | **$78/mo** | **+$39/mo** |

For ~$40/month, we get hard production isolation. That's table stakes.

---

## 9. Open questions for the founder

1. **Custom domain `staging.forge.app`** — confirm registrar access to add the DNS record.
2. **`VERCEL_ENV=staging` env var** — Vercel exposes `VERCEL_ENV` as `production` / `preview` / `development`. We may need a custom env var for our own logic (e.g. `FORGE_ENV=staging`).
3. **Who in addition to the founder approves prod deploys?** Recommend: founder + engineering lead. Document in `docs/PRODUCTION_DEPLOY_GATE.md`.
4. **Should staging accept signups from the public?** Recommend NO — IP allow-list or basic auth in front of staging to keep it private.

---

## 10. Status checklist

Track progress here:

- [ ] Step 1: prod Neon project created
- [ ] Step 2: existing Neon project renamed to staging
- [ ] Step 3: migrations applied to prod project
- [ ] Step 4: staging Vercel project created
- [ ] Step 5: existing Vercel project reconfigured for prod
- [ ] Step 6: `release` branch created
- [ ] Step 7: GitHub environment protection rule set
- [ ] Step 8: prod secrets rotated
- [ ] Step 9: smoke test passed
- [ ] Step 10: code-side env guards landed (separate PR)
