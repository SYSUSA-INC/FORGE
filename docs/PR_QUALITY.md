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

### Tier 2 — robotic quality gates (this file describes these, `.github/workflows/pr-quality.yml`)

| Gate | What it catches | Bypass |
|---|---|---|
| PR title format | Non-conventional commit titles | None |
| Backlog hygiene | PRs that reference a `BL-N` but don't touch `docs/BACKLOG.md` | Remove the BL reference from title/body if it's incidental |
| Schema / migration coupling | `src/db/*.ts` changes without a matching `drizzle/*.sql` | Label: `schema-no-migration` (type-only changes) |
| Diff-size guard | PRs over 1,500 LOC (added + deleted, excl. lock files) | Label: `oversized-ok` (justify in PR description) |
| Secret scan | Common credential shapes in newly-added lines | Move legitimate matches under `*.md` or `*/fixtures/*` |

**ESLint** is deferred to **BL-QC-lint**. The project currently has no
`.eslintrc` so `next lint` prompts interactively, which would block
every PR. The follow-up configures ESLint with the Next.js + TypeScript
preset, fixes any existing violations, and lands the gate.

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

## Branch-protection settings checklist

One-time configuration on the `main` branch, then it self-enforces:

- ✅ Require pull request before merging
- ✅ Require status checks to pass before merging
  - All Tier 0 + Tier 2 job names listed
  - **Vercel Agent Review** added (promotes Vercel Agent from advisory to blocking)
- ✅ Require branches to be up to date before merging (combined with the diff-size guard, this disciplines parallel PRs)
- ✅ Require conversation resolution before merging
- ✅ Require review from Code Owners
- ✅ Restrict who can dismiss pull request reviews (admins only)
- ✅ Do not allow bypassing the above settings (no admin bypass)

Together these mean: every merge into `main` passes the full robotic
stack AND has a code-owner sign-off, with no admin escape hatch.
