# FORGE — Production Deploy Gate

**Goal:** A manual approval step between `merge to main` and `deploy to production`.

**Status:** This document is the runbook. The gate itself is set up via GitHub's "Environment protection rules" + a Vercel project split. Setup is one-time and takes ~30 minutes.

**Last updated:** 2026-06-16

---

## 1. Why we need this

Until now, every merge to `main` auto-deploys to the live `app.forge.app` URL. That was fine pre-customer. Once we have paying customers, **every change to production must be deliberate**:

- We can't silently push broken code at 2 AM.
- We can't accidentally roll out a hotfix that wasn't reviewed.
- A junior engineer's PR can't single-handedly break production.

The gate adds 30 seconds to every deploy: the approver clicks "Deploy" on a GitHub Actions run. That's it.

---

## 2. Target architecture

```
feature branch ─PR─► main ──auto-deploy──► staging.forge.app  (Vercel staging project)
                                            │
                                            │ (smoke-test, founder sign-off)
                                            │
                                            ▼
                       PR: main → release ──manual approval──► app.forge.app (Vercel prod project)
```

Two Vercel projects, one Neon **project** per environment (not just branches — full project separation; see `docs/ENVIRONMENTS.md`).

---

## 3. Setup (one-time, ~30 minutes)

### Step 1: Create a second Vercel project for staging

The current Vercel project is bound to `app.forge.app` — we keep that as **production**. We create a NEW project for **staging**.

1. https://vercel.com → **New Project** → import the same GitHub repo
2. Name it `forge-staging`
3. Production branch: `main`
4. Custom domain: `staging.forge.app`
5. Env vars: copy from prod, but point `DATABASE_URL` at the **staging Neon project** (not a branch — separate project; see `docs/ENVIRONMENTS.md`)
6. Set `VERCEL_ENV=staging` as an env var so the app code can render a non-prod banner

### Step 2: Reconfigure the existing (prod) Vercel project

1. Vercel → existing FORGE project → Settings → Git
2. Change **Production Branch** from `main` to `release`
3. Disable **Auto-deploy on PR merge for non-production branches** (we don't need prod previews from random branches)
4. The project keeps `app.forge.app` as its custom domain

### Step 3: Create the `release` branch in the repo

```sh
git checkout main
git pull
git checkout -b release
git push -u origin release
```

### Step 4: Add GitHub Environment Protection Rule

This is the magic step that creates the manual approval gate.

1. GitHub → FORGE repo → Settings → **Environments**
2. Click **New environment** → name: `production`
3. Under **Deployment protection rules:**
   - ✅ **Required reviewers**: add the founder and engineering lead (one approval required)
   - ✅ **Wait timer**: 0 minutes (we want fast deploys, just want the approval)
   - ✅ **Deployment branches**: restrict to `release` branch only
4. Save

### Step 5: Wire the GitHub Actions workflow to require the environment

Create `.github/workflows/production-deploy.yml`:

```yaml
name: Production deploy
on:
  push:
    branches: [release]

jobs:
  deploy:
    name: Deploy to production
    runs-on: ubuntu-latest
    environment: production  # ← this triggers the approval gate
    steps:
      - name: Trigger Vercel deploy
        run: |
          curl -X POST \
            -H "Authorization: Bearer ${{ secrets.VERCEL_DEPLOY_HOOK }}" \
            https://api.vercel.com/v1/integrations/deploy-hooks/<hook-id>
```

The `environment: production` line is what activates the approval gate. When the workflow tries to run, GitHub pauses it and DMs the required reviewers. Once approved, the deploy fires.

### Step 6: Test the gate

1. Open a trivial PR to `main` → verify it deploys to `staging.forge.app` only
2. Open a PR to merge `main` → `release`
3. Confirm the production-deploy workflow shows as **Waiting for approval**
4. As the approver, click **Review deployments** → approve
5. Confirm `app.forge.app` updates with the new code

---

## 4. Daily promotion flow (after setup)

Most days, the promotion is a one-click ritual.

```
Day-to-day:
1. Developer opens PR → main → CI gates run → review → merge
2. Vercel auto-deploys to staging.forge.app
3. (Optional) smoke-test on staging
4. Founder/lead opens a PR: main → release
5. CI gates re-run on the release branch (same checks as PR-to-main)
6. Founder/lead merges main → release
7. GitHub Actions starts the production deploy
8. GitHub waits for approval → notification fires
9. Founder/lead approves → deploy runs
10. Vercel deploys to app.forge.app — done
```

Total time added: ~30 seconds in step 8.

---

## 5. Hotfix flow

When the gate is in the way (genuine production-down emergency):

```
1. Branch off release (NOT main): git checkout -b hotfix/X release
2. Apply the minimal fix
3. PR straight to release (skipping main — backfill main later)
4. CI gates pass
5. Approve the deploy
6. Once stable, open a follow-up PR to backport the hotfix to main so master keeps the fix
```

**Never skip CI gates** — the approval gate exists; CI gates exist. Both must pass.

---

## 6. Rollback

The approval gate also helps rollback. To revert prod:

1. GitHub → Deployments → find the previous good production deploy
2. Click **Redeploy** or use the Vercel "Promote to Production" on the previous deploy
3. Both options are instant (~30 sec to propagate)

---

## 7. What this does NOT solve

- **Bad code that passes CI and the approver doesn't notice.** Mitigated by: pre-push self-review CI gate, the existing CI gates, and the staging smoke-test step.
- **A migration that breaks prod when the gate is approved.** Mitigated by: destructive-blocker, drift detector, and pre-deploy Neon snapshot (once `NEON_API_KEY` is configured).
- **An approver compromised by phishing.** Mitigated by: MFA enforcement, hardware keys.

The gate is one layer of defense, not all of them.

---

## 8. Audit trail

Every production deploy creates a record in:
- **GitHub Deployments tab** — who deployed, when, what commit, who approved
- **Vercel deployments log** — same plus the build output
- **`audit_log`** — if we want to record deploys in-app, add a server action that calls `recordAudit` from the post-deploy hook. (Future work.)

This trail is what an SOC 2 auditor will ask to see.
