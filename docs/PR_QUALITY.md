# Pre-merge quality gates

Every PR clears a stack of robotic checks before merge is enabled.
Each gate is its own required status check on `main` and can be
toggled individually in **Settings → Branches → main**. This document
describes the stack, how to add a new gate, and the (limited)
mechanisms for legitimately bypassing one.

## The stack

### Tier 0 — required gates (existing, `.github/workflows/pr.yml`)

| Gate | What it catches |
|---|---|
| Type check | `tsc --noEmit` errors |
| Next build | RSC boundary bugs, server/client import violations |
| RSC boundary check | Server components importing non-component named exports from `"use client"` files |
| Multi-tenant isolation check | Server actions touching tenant-scoped tables without an auth gate + `organizationId` scope (BL-19) |
| Fresh-DB migration verification | Migrations that depend on already-migrated state and would break a fresh deploy |

### Tier 1 — third-party gates

| Gate | What it catches |
|---|---|
| Vercel Preview deploy | Build failures that the typecheck / next-build steps don't catch (env-resolution issues, edge runtime, etc.) |
| Vercel Agent Review | Style / clarity / suggested-fix issues. Currently advisory by default — promote to required status check to make it blocking. |
| **Neon branch lifecycle** | Per-PR DB branch off the project's `main` so the Vercel preview deploy + fresh-DB migration test against real production schema state. Auto-deletes on PR close. Requires `NEON_API_KEY` + `NEON_PROJECT_ID` configured (see operator setup below); soft-skips with a `::notice::` annotation when not configured. |

### Tier 2 — robotic quality gates (this file describes these, `.github/workflows/pr-quality.yml`)

| Gate | What it catches | Bypass |
|---|---|---|
| ESLint | Lint errors `tsc` doesn't catch (unused imports, exhaustive-deps, etc.) | None |
| PR title format | Non-conventional commit titles | None |
| Backlog hygiene | PRs that reference a `BL-N` but don't touch `docs/BACKLOG.md` | Remove the BL reference from title/body if it's incidental |
| Schema / migration coupling | `src/db/*.ts` changes without a matching `drizzle/*.sql` | Label: `schema-no-migration` (type-only changes) |
| Diff-size guard | PRs over 1,500 LOC (added + deleted, excl. lock files) | Label: `oversized-ok` (justify in PR description) |
| Secret scan | Common credential shapes in newly-added lines | Move legitimate matches under `*.md` or `*/fixtures/*` |
| Drizzle schema validate | Snapshot / journal inconsistency in `drizzle/meta/` | None — fix the schema |

### Tier 3 — human review (`.github/CODEOWNERS`)

Sensitive paths require explicit code-owner approval on top of every
robotic check above. Routed automatically by GitHub when these paths
appear in a PR:

- `src/db/` — schema
- `drizzle/` — migrations
- `src/auth.ts`, `src/lib/auth-helpers.ts` — auth primitives
- `src/lib/audit-log.ts` — audit + retention
- `scripts/check-isolation.mjs`, `.isolation-allow.json` — multi-tenant enforcement
- `.github/` — CI / workflows / CODEOWNERS itself

## Adding a new gate

1. Add a new `jobs.<name>` block to `.github/workflows/pr-quality.yml`. Each gate is independent — no shared state, no ordering.
2. Name the job clearly; the `name:` field is what appears in the status-check list.
3. Run the workflow on a draft PR to verify it passes / fails as expected.
4. Once merged to `main`, an admin adds the job's display name to **Settings → Branches → main → Require status checks**. The gate is advisory until that toggle is flipped.

## Legitimate bypasses

Three labels are recognized:

- `schema-no-migration` — schema-coupling gate skips. Use only for type-only edits with no SQL impact.
- `oversized-ok` — diff-size gate skips. Use sparingly; large PRs are harder to review. Always justify the size in the PR description.

Anything else — including "this is a CI flake" — gets addressed at the source rather than bypassed. Fix the underlying issue in the same PR or a follow-up; don't relax the gate.

No label exists for any other gate. If a check is genuinely wrong, fix the workflow definition itself in the same PR.

## Operator setup checklist

### Branch protection (Settings → Branches → main)

- ✅ Require pull request before merging
- ✅ Require status checks to pass before merging
  - All Tier 0 + Tier 2 job names listed
  - **Vercel Agent Review** added (promotes Vercel Agent from advisory to blocking)
  - **Create Neon branch** + **Delete Neon branch** added (once configured)
- ✅ Require branches to be up to date before merging (combined with the diff-size guard, this disciplines parallel PRs)
- ✅ Require conversation resolution before merging
- ✅ Require review from Code Owners
- ✅ Restrict who can dismiss pull request reviews (admins only)
- ✅ Do not allow bypassing the above settings (no admin bypass)

### Neon branch lifecycle (Settings → Secrets and variables → Actions)

To activate the per-PR Neon branch workflow:

1. Generate a Neon API key in the [Neon console](https://console.neon.tech) under your account → API keys
2. Add to the repo as a **secret**: `NEON_API_KEY`
3. Find your Neon project ID (Neon console → your project → Settings → General)
4. Add to the repo as a **variable** (not a secret — it's not sensitive): `NEON_PROJECT_ID`
5. (Optional) If your Neon branch parent isn't `main`, add variable `NEON_BRANCH_PARENT` with the parent name
6. (Optional) If your Neon role isn't `forge`, add variable `NEON_USERNAME` with the role name
7. (Optional but recommended) In Vercel: connect the project to your Neon project via the official Vercel-Neon integration. Vercel will automatically use the per-PR branch's connection string in the Preview environment.

Once configured, every PR creates a Neon branch named `pr-<number>` off the parent branch; the workflow posts a comment on the PR with the (password-masked) connection string. Closing/merging the PR deletes the branch.

The workflow is **safe to merge before configuring**: the lifecycle jobs detect the missing secret/variable and exit cleanly with a `::notice::` annotation rather than failing.

Together these mean: every merge into `main` passes the full robotic
stack AND has a code-owner sign-off, with no admin escape hatch.
