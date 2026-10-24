# Agent guidelines — FORGE

> AI coding tools (Cursor, Claude, Copilot, etc.) and automated
> reviewers: read this file first, then read the canonical standards
> at `docs/ENGINEERING_STANDARDS.md`.

## Quick orientation

- **Stack:** Next.js 14 App Router, TypeScript, Drizzle ORM,
  PostgreSQL (Neon), Vercel hosting
- **Multi-tenant:** every row in every business table carries
  `organization_id`. Every server action that touches one must call
  an auth gate + scope by `organizationId`. See §1 of
  `docs/ENGINEERING_STANDARDS.md`.
- **Pre-merge gate stack:** 7 robotic gates in
  `.github/workflows/pr-quality.yml` + 5 in `.github/workflows/pr.yml`
  (type check and ESLint share one job) + Vercel Preview deploy +
  CODEOWNERS. See §7 of the standards doc.
- **Backlog:** `docs/BACKLOG.md` is the single source of truth for
  planned work. Every PR referencing `BL-N` must update the backlog
  entry (enforced by gate).

## What to flag in review

✅ **Worth flagging:**

- Missing `recordAudit` / `recordRead` / `recordAuthDenied` on the
  paths defined in §2 of the standards doc
- Subtle isolation issues the static check might miss (e.g., a query
  on a tenant table where `organizationId` is referenced but not
  actually used in the `where` clause)
- Use of `user.organizationId` from the session in a query (should be
  `requireCurrentOrg()` result)
- Missing `revalidatePath("/")` on mutations that change Command
  Center counts (see BL-7 in BACKLOG.md)
- New server actions that take `organizationId` as a parameter
  (anti-pattern — pulls from caller-controlled input)
- Drizzle schema changes without matching `drizzle/*.sql` migrations
  (the schema-migration coupling gate already enforces presence; you
  should flag content mismatches)
- Secrets / credentials accidentally committed (the secret-scan gate
  covers common shapes; flag anything ambiguous)
- Auth gates inverted or missing on admin / super-admin routes
- Cron handlers without `Authorization: Bearer ${CRON_SECRET}` check
- A file reaching a server action in a shape the no-files test can't
  see: a `FormData` entry handed to a helper unlooked-at, or a file's
  bytes, base64 or whole text sent as an argument (upload it with
  `uploadFile()` instead; see convention 11)
- Hard-coded `#RRGGBB` colours or `rgba(...)` palette values in
  components (use Tailwind tokens or `THEME` from
  `src/lib/theme-colors.ts`; see `docs/DESIGN_SYSTEM.md`)

❌ **Don't flag** (already enforced by gates — would be noise):

- Conventional commit titles (PR title format gate enforces)
- `package-lock.json` size (excluded from diff-size guard intentionally)
- ESLint violations (Type check + ESLint gate catches)
- TypeScript compile errors (Type check + ESLint gate catches)
- RSC boundary violations (RSC boundary check catches)
- Fresh-DB migration failures (Fresh-DB migration verification catches)
- Tenant-scoped queries without `organizationId` (Multi-tenant
  isolation check catches statically)
- A `File`/`Blob` parameter, cast or `instanceof` check, or
  `.arrayBuffer()`/`.blob()`/`.stream()`/`.bytes()`, written in a
  `"use server"` file: `tests/ai/no-files-through-server-actions.test.ts`
  fails the Runtime isolation tests gate

## Conventions to follow when authoring

When writing code yourself (Claude, Cursor, etc.):

1. **Auth gate first.** Every `"use server"` async function on a
   tenant-scoped table opens with `requireAuth()` /
   `requireCurrentOrg()` etc. before any DB query.
2. **Scope every query.** `eq(table.organizationId, organizationId)`
   on every tenant-table read/write.
3. **Audit every mutation.** `recordAudit({...})` after the DB write,
   before `revalidatePath`.
4. **`"use server"` files don't export non-async values.** Next.js
   rejects the build. Move constants to a sibling `*-constants.ts`.
5. **Migrations + schema ship together.** Adding a column? Edit
   `src/db/schema.ts` AND add a `drizzle/[NNNN]_*.sql` file.
6. **Conventional commit titles.** `<type>(<scope>)?: <summary>`.
7. **Reference the BL ticket in the title.** `feat(audit): BL-12c —
   …`. Then update `docs/BACKLOG.md` in the same PR.
8. **Diff under 1,500 LOC.** Split larger work into phased PRs.
9. **One PR at a time.** Strict serial.
10. **Strict serial — don't bypass gates.** Every check has a reason;
    don't suggest disabling one to ship faster.
11. **Files go to storage, never through a server action.** The
    browser uploads with `uploadFile()` (`src/lib/upload-client.ts`)
    and the action files it by upload id: `claimUpload`, read it with
    `getVerifiedObject`, then `finishClaim` / `releaseClaim` /
    `failClaim` with the claim's `claimedAt` (`src/lib/uploads.ts`).

12. **Update the manuals in the same PR.** Any change a user or an
    admin can see or feel (screens, labels, colours, emails, limits,
    sign-in or security behaviour) updates `docs/USER_MANUAL.md`
    and/or `docs/ADMIN_MANUAL.md`, and its "What's new" list when it
    is a feature. Say in the PR which sections changed, or why none
    did.

## Where to look

- `docs/ENGINEERING_STANDARDS.md` — canonical standards (this is the
  authoritative reference)
- `docs/BACKLOG.md` — planned work, in BL-N order
- `docs/PR_QUALITY.md` — the gate stack in detail
- `docs/DESIGN_SYSTEM.md` — colour tokens, semantic families and UI
  conventions (BL-UI-THEME)
- `docs/USER_MANUAL.md` / `docs/ADMIN_MANUAL.md` — user-facing
  feature docs (helpful for understanding domain language)
- `.github/CODEOWNERS` — which paths need explicit human approval
- `.github/workflows/*.yml` — the gate definitions themselves
- `.isolation-allow.json` — documented exceptions to the multi-tenant
  isolation contract