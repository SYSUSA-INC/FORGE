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

- **Constant-condition filter/map callbacks.** An `array.filter(() => CONDITION)`
  where `CONDITION` doesn't reference the callback parameter is
  misleading — it either passes everything or nothing, but the
  filter pattern suggests per-element discrimination. Replace with
  an early-out (`if (!CONDITION) return/continue`) before the array
  operation. Same for `.map((_, i) => ...)` patterns that ignore
  the element. Caught on [#153](https://github.com/SYSUSA-INC/FORGE/pull/153)
  — added here so future reviews catch it before the agent does.

- **Drizzle index parity gaps.** When a `CREATE INDEX` (especially a
  partial index with a `WHERE` clause) lands in a SQL migration, the
  matching `index(...)` (with `.where(sql\`...\`)`) must also appear
  in `src/db/schema.ts`. Otherwise `drizzle-kit generate` regenerating
  from schema would drop the index. Caught on [#150](https://github.com/SYSUSA-INC/FORGE/pull/150).

- **Auth gate missing on admin-only pages.** Server components under
  `(app)/` that should be admin-only must call
  `requireOrgAdmin(organizationId)` after `requireCurrentOrg()`, not
  rely on nav visibility. Caught on [#150](https://github.com/SYSUSA-INC/FORGE/pull/150).

- **Inbox-parity for `in_app` deliveries.** Anywhere we write a
  `notification_delivery` row with `channel === "in_app"`, we MUST
  also insert a matching row in the legacy `notification` table.
  The dispatcher in `src/lib/notification-dispatcher.ts` does both;
  the SLA cron in `src/lib/notification-cron.ts` originally only
  wrote the delivery row, so escalations never reached the inbox.
  Caught on [#155](https://github.com/SYSUSA-INC/FORGE/pull/155).
  Rule: if you create a `notification_delivery` with channel
  in_app, the next thing in scope must be the matching `notification`
  insert.

- **SELECT-then-UPDATE race on the same predicate.** When a cron or
  job pattern is "SELECT rows matching X → process → UPDATE rows
  matching X to mark them done," the UPDATE must filter by the
  IDs collected from the SELECT, NOT re-apply predicate X. A new
  row inserted between SELECT and UPDATE that also matches X gets
  marked done without being processed. Caught on [#155](https://github.com/SYSUSA-INC/FORGE/pull/155): the
  batch materializer's UPDATE used `sentAt IS NULL` instead of
  `inArray(id, pendingIds)`, racing with the dispatcher.
  Rule: select rows → collect their IDs → update where
  `inArray(id, [those ids])` (plus the tenant scope).

- **Missing migrations.** If a PR changes `src/db/schema.ts` types in
  a way that affects the generated SQL, there must be a corresponding
  `drizzle/[NNNN]_*.sql` file. The schema-migration coupling gate
  enforces file presence; you should flag content mismatches (e.g., a
  schema column added but the migration is empty).

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