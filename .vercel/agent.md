# Vercel Agent — review guidelines for FORGE

Read this file before reviewing any PR in this repo. The canonical
standards live at `docs/ENGINEERING_STANDARDS.md`; this file is the
Vercel-Agent-specific subset that tells you what to focus on and what
to skip.

## What to flag (uncovered by automated gates)

These are the categories where your review adds the most value
because no other CI gate catches them:

- **Missing audit log calls.** Every mutation on a tenant-scoped
  table should call `recordAudit(...)` from `@/lib/audit-log` after
  the DB write. Every sensitive read (PDF render, share-link load,
  USAspending lookup, etc.) should call `recordRead(...)`. Every
  `require*` auth-helper deny path should call `recordAuthDenied(...)`.
  See §2 of `docs/ENGINEERING_STANDARDS.md`.

- **Subtle isolation issues.** The static isolation check
  (`scripts/check-isolation.mjs`) verifies that server actions
  touching tenant tables call an auth gate AND reference
  `organizationId` in the function body. It can miss cases where
  `organizationId` is referenced but not actually used in the query's
  `where` clause. Flag those.

- **Session-derived org context.** Using `user.organizationId` from
  the session in a query is an anti-pattern — the session can lag
  the current org context. Should be the result of
  `requireCurrentOrg()`.

- **`organizationId` as a server-action parameter.** Server actions
  that take `organizationId` as input are caller-controlled and
  bypass tenant isolation. Pull from `requireCurrentOrg()` instead.

- **Cache invalidation gaps.** Mutations on opportunities or
  proposals that change Command Center counts should
  `revalidatePath("/")` in addition to per-route invalidations. See
  BL-7 in `docs/BACKLOG.md`.

- **Cron handlers without auth.** Anything under `src/app/api/cron/`
  must verify `Authorization: Bearer ${CRON_SECRET}` and refuse to
  run if the secret isn't set.

- **Missing migrations.** If a PR changes `src/db/schema.ts` types in
  a way that affects the generated SQL, there must be a corresponding
  `drizzle/[NNNN]_*.sql` file. The schema-migration coupling gate
  enforces file presence; you should flag content mismatches (e.g., a
  schema column added but the migration is empty).

- **Drizzle index parity.** When a `CREATE INDEX` lands in a SQL
  migration, the matching `index(...)` call should also be in
  `src/db/schema.ts` so future migrations regenerated from the schema
  don't drop the index. (BL-13 Phase A's [#150](https://github.com/SYSUSA-INC/FORGE/pull/150) had this exact gap; good
  catch.)

## What NOT to flag (already enforced by CI)

These will surface as redundant noise — skip them:

- **Conventional commit format** — enforced by the "PR title format"
  gate
- **ESLint rule violations** — enforced by the ESLint gate
- **Unused imports** — caught by ESLint's no-unused-vars rule
- **TypeScript errors** — caught by Type check
- **RSC boundary violations** — caught by the RSC boundary check
- **Fresh-migration failures** — caught by Fresh-DB migration verification
- **Static isolation violations** — caught by Multi-tenant isolation check
- **Secrets in code** — caught by Secret scan (regex-based)
- **Diff over 1,500 LOC without label** — caught by Diff-size guard
- **Missing BACKLOG.md update on BL-N PRs** — caught by Backlog hygiene
- **Schema changes without a migration file** — caught by Schema /
  migration coupling

## Severity guidance

- **Security:** auth gate inversion, leaked secrets, missing audit on
  mutations, cross-tenant data leaks → high priority, block merge
- **Maintainability:** missing index parity, missing
  `revalidatePath`, anti-pattern usage → medium, fix before merge
- **Style:** anything ESLint or Prettier would catch → don't post (the
  gate handles it)

## Repository-specific shorthand

- `BL-N` (e.g., `BL-12`, `BL-12c`, `BL-QC`) refers to backlog entries
  in `docs/BACKLOG.md`. Each PR references its BL ticket in the title.
- "Tier 0 / Tier 1 / Tier 2 / Tier 3 gates" refer to the layered
  pre-merge stack documented in §7 of `docs/ENGINEERING_STANDARDS.md`.
- "Strict serial" = the discipline of one PR open at a time.
- The current branch convention for AI-authored PRs is
  `claude/<bl-id>-<slug>` (e.g., `claude/bl-13-phase-a-notifications-schema`).