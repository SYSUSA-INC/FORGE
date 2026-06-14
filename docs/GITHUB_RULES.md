# GitHub branch protection — current state

This document is the authoritative record of how `main` is protected
on GitHub. When the rules change, update this file in the same PR.

Settings live at: `Settings → Branches → main rule` (classic branch
protection). The newer Rulesets feature at `Settings → Rules` is
NOT in use — classic protection is sufficient for current needs and
simpler to reason about. Migration to Rulesets is a future
consideration when team grows or multi-branch policy is needed.

## What's on right now

### Required status checks (13)

All 13 must pass before the merge button enables. None are advisory.

**Tier 0 — from `.github/workflows/pr.yml`:**

1. Fresh-DB migration verification
2. Next build
3. RSC boundary check
4. Type check
5. Multi-tenant isolation check

**Tier 2 — from `.github/workflows/pr-quality.yml`:**

6. ESLint
7. PR title format (conventional commits)
8. Backlog hygiene (BL-N references must touch BACKLOG.md)
9. Schema / migration coupling
10. Diff-size guard
11. Secret scan (added lines)
12. Pre-push self-review section
13. Drizzle schema validate

### Other rules enabled

- ✅ **Require status checks to pass before merging** — links to the 13 above
- ✅ **Require branches to be up to date before merging** — disciplines parallel PRs against each other
- ✅ **Require conversation resolution before merging** — all PR review threads must be marked resolved
- ✅ **Do not allow bypassing the above settings** — administrators (including the repo owner) cannot merge a PR with failing required checks

### Explicitly NOT enabled (intentional)

These look like obvious additions but each has a reason to stay off:

- ❌ **Require pull request reviews** / **Require N approvals** — GitHub doesn't let you approve your own PR. With a solo developer this would permanently block every merge. Re-enable when team ≥ 2 humans.
- ❌ **Require review from Code Owners** — same self-approval trap. The `.github/CODEOWNERS` file still routes reviewers automatically when applicable; the *requirement* gets turned on when there's a second pair of eyes.
- ❌ **Require signed commits** — would require GPG / SSH commit signing setup. Low ROI for a solo project; revisit if compliance pressure increases.
- ❌ **Require linear history** — squash-on-merge already gives a tidy log without forcing rebase discipline on every author.
- ❌ **Require deployments to succeed** — Vercel preview deploy already covers the "did it build" question via the Next-build gate. Adding a deploy requirement would couple merges to Vercel-side state with no quality gain.
- ❌ **Vercel Agent Review** — retired (see `BL-QC-vercel-agent-retired` in BACKLOG). Was never added as a required check.
- ❌ **Create Neon branch / Delete Neon branch** — soft-skip when `NEON_API_KEY` isn't configured. Making them required would break PRs in any environment without the secret.
- ❌ **Vercel Preview Comments** — informational only.

## When to change the rules

### When team grows to ≥ 2 humans

Re-enable:

1. **Require a pull request before merging** (already implied by status-check requirements; make it explicit)
2. **Require approvals: 1** (or 2 for sensitive paths via CODEOWNERS)
3. **Require review from Code Owners**
4. **Dismiss stale pull request approvals when new commits are pushed** (so an approval doesn't carry over to a re-pushed branch with new content)

### When you add a new CI gate

1. Land the workflow as a non-required check first (advisory)
2. Watch it run on 3–5 real PRs to confirm no false positives
3. Add the job's display name to the required-checks list in the branch protection rule
4. Update this document with the new entry in the table above

### When you remove a CI gate

1. Remove the job's display name from the required-checks list **first**
2. Then delete the workflow / job
3. If the gate was advisory only, just delete — no protection edit needed
4. Update this document

## How to verify the current state matches this doc

1. Navigate to `https://github.com/SYSUSA-INC/FORGE/settings/branches`
2. Click `Edit` on the `main` rule
3. Cross-reference each section above against the live rule UI
4. If anything has drifted (added or removed a check, toggled a setting), update this file in the same PR that touches the rule. Drift between this doc and the live config means the doc has stopped being authoritative — and once that happens it stops being read.

## Audit trail

Branch-protection changes don't surface in `git log`. The audit trail
lives in **Settings → Audit log** at the org level (`webdev-platform`)
under the `repo.branch_protection.update` event. Keep that in mind
when investigating "why did this PR merge with a failing check?" —
the answer is usually a rule edit by an admin, visible only there.

## History

- **2026-06-14 (PR #189-era):** Original lockdown — added all 13 Tier 0 + Tier 2 gates to the required list, enabled `Do not allow bypassing`. Replaced the partial set (5 Tier 0 checks only) that had been in place since the gate stack first shipped.
- **2026-06-14 (PR #190):** Vercel Agent retired; "Vercel Agent Review" never was a required check, but the obsolete "promote to required" operator follow-up was struck from BACKLOG.
- **2026-06-14 (this PR):** This file created to document the current state authoritatively.
