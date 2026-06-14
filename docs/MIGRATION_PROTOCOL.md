# Database migration protocol — FORGE

How schema changes ship safely from PR through production, with
rollback paths when something goes wrong.

## The shape

```
PR opened ──────► PR merged ─────► Deploy starts ────► Server cold-start ──► Migration applied
                       │                                       │
                       │                                       └─► Neon snapshot taken (if configured)
                       │
                       └─► Fresh-DB CI gate proves migration applies cleanly
```

## Authoring a migration

Migrations live in `drizzle/[NNNN]_<slug>.sql`, numbered sequentially
without gaps. A migration ships in the same PR as the matching
`src/db/schema.ts` change — enforced by the **Schema / migration
coupling** CI gate (`.github/workflows/pr-quality.yml`).

### Rules

1. **Idempotent.** Use `IF NOT EXISTS` on `CREATE` statements, `ON
   CONFLICT DO NOTHING` on `INSERT` statements where appropriate, and
   guard `ALTER TYPE ... ADD VALUE` with `IF NOT EXISTS`. Auto-apply
   may re-run a migration on retry; idempotent statements are a no-op
   the second time.

2. **Header comment.** Every migration opens with a brief description
   of what's being added and why. Future you (and Vercel Agent — wait,
   we retired that, your reviewer self) will appreciate context.

3. **Forward-only.** Don't write `-- @down` blocks. To revert a bad
   migration, write a new compensating migration (e.g., `0050_revert_X.sql`
   that undoes what `0049_X.sql` did). This pattern keeps the migration
   ledger linear and avoids the down-migration maintenance debt.

4. **Avoid destructive ops if possible.** The auto-apply guard
   (see below) will refuse to apply `DROP TABLE`, `DROP COLUMN`, `DROP
   TYPE`, `TRUNCATE`, and `ALTER COLUMN ... TYPE`. They require manual
   application. If you can express the change additively (e.g., add a
   nullable replacement column, deprecate the old one in code, drop in
   a later cleanup migration once you've verified nothing reads it),
   prefer the additive path.

5. **Hash immutability.** Once a migration file has been applied on
   any environment, never edit its content. The runner stores a sha256
   of every applied migration in the `_forge_migration` ledger and
   refuses to proceed if the hash drifts. To fix a bug in an already-
   applied migration, write a new follow-up.

## Auto-apply on deploy

**Lives in:** `src/instrumentation.ts` → `register()` → `runAutoMigrateThenVerify()`

**Triggered on:** every Node.js runtime cold start (i.e., every fresh
server function boot).

**Single-flight:** uses a Postgres advisory lock
(`pg_try_advisory_lock(7240613514)`). Only one server instance applies
at a time; others see "lock-held" and exit cleanly without retrying.

**Flow:**

1. Skip if `DISABLE_AUTO_MIGRATE=1` env var is set
2. Skip if no pending migrations (the common case)
3. Refuse + log a warning if any pending migration contains
   destructive ops — operator must apply manually via `/admin/migrations`
4. Acquire the advisory lock (non-blocking try)
5. Take a Neon branch snapshot (if `NEON_API_KEY` is configured)
6. Apply pending migrations sequentially, each in its own transaction
7. Release the lock

**What gets logged:**

| Outcome | Log level | Where to look |
|---|---|---|
| Applied 1+ migrations | `info` | Vercel logs, tag `[auto-migrate]` |
| Nothing pending | (silent — common case) | — |
| Destructive ops blocked | `warn` | Vercel logs + `/admin/migrations` UI |
| Lock held by another instance | `info` | Vercel logs |
| Apply failed | `error` | Vercel logs |

## What auto-apply refuses

Static regex scan flags these patterns as destructive:

- `DROP TABLE`
- `DROP COLUMN`
- `DROP TYPE`
- `DROP DATABASE`
- `DROP SCHEMA`
- `TRUNCATE`
- `ALTER COLUMN ... (SET DATA) TYPE`

These can lose data, fail in production with already-populated tables,
or take down dependent code paths in ways that aren't recoverable
without a snapshot. The refusal forces a human to ack the risk.

**NOT refused** (auto-apply runs these):

- `ADD COLUMN`, `ADD CONSTRAINT`, `CREATE INDEX`, `CREATE TABLE`
- `ALTER TYPE ... ADD VALUE`
- `DROP INDEX` (perf hit, recoverable)
- `DROP CONSTRAINT` (semantics change, no data loss)
- `INSERT`, `UPDATE`, `DELETE` (row-level — trusted to be reviewed in PR)

If a migration legitimately needs to be destructive, run it manually
via `/admin/migrations` after explicitly reviewing the impact.

## Rollback procedure

The right path depends on what failed.

### Scenario A — Auto-apply failed mid-batch

`tryAutoApplyMigrations` returns `kind: "failed"`. Some migrations
applied, others didn't.

1. Open `/admin/migrations` — the ledger shows which files made it in
2. Find the latest-applied file
3. Check the failed migration's SQL — fix the bug in a NEW migration
4. Push the fix; next cold start picks up from where the batch failed

If the failure left the schema in a state code can't run against:

1. Promote a previous Vercel deployment (Vercel → Deployments → ⋯ →
   Promote to Production)
2. Restore the Neon snapshot taken at the start of auto-apply (if
   `NEON_API_KEY` was set; otherwise use Neon PITR — see below)
3. Investigate, fix forward in a new PR

### Scenario B — Migration applied but downstream code is broken

The migration succeeded but a bug in the code is causing crashes
(e.g., a NULL value where the code assumed non-NULL).

1. **Promote previous Vercel deployment.** Instant code rollback.
2. If the schema change is **additive** (nullable column added, new
   table, enum value extended), the old code typically still works
   against the new schema — no Neon restore needed.
3. If the schema change is **breaking** (column removed, type
   changed), and the old code expects the old schema:
   - Restore from the auto-apply Neon snapshot (Neon dashboard →
     Branches → find `auto-migrate-<timestamp>` → Promote to primary)
   - OR use Neon PITR to restore the primary branch to a moment
     before the apply (Neon Pro plan, 7-day window)
4. Fix forward in a new PR

### Scenario C — Need to revert a logically-bad migration

The migration applied cleanly, the deploy succeeded, but you realize
the schema decision was wrong (e.g., column name mistake, wrong type).

1. **Don't roll back the original migration.** Write a compensating
   one: `00NN_rename_X_to_Y.sql` or `00NN_drop_misnamed_column.sql`.
2. Ship the compensating migration as a new PR.
3. If the compensating migration is destructive (very likely — fixing
   a rename probably needs `DROP COLUMN`), auto-apply will refuse and
   you'll apply it via `/admin/migrations` with explicit ack.

## Neon snapshot mechanics

When configured (`NEON_API_KEY` + `NEON_PROJECT_ID` set in Vercel
env), auto-apply calls `tryCreateBranchSnapshot()` before running any
SQL. The snapshot is a Neon branch named
`auto-migrate-<ISO timestamp>`, parented off the production branch.

**Snapshots are cheap.** Neon uses copy-on-write storage; a snapshot
of a 10 GB database costs roughly zero until the original branch
diverges from it.

**Restore:**

1. Neon console → Project → Branches
2. Find the snapshot (`auto-migrate-2026-06-14T...`)
3. Click the three-dot menu → **Promote to primary**
4. Vercel will reconnect to the new primary on the next cold start
   (or trigger a redeploy to force it)

**Cleanup:**

Snapshots accumulate. The 7-day Neon PITR window means anything
older than that loses most of its rollback value. To prune:

- Neon console → Branches → delete branches older than 7 days
- Or set a manual rotation policy (every Monday, delete >7-day-old
  `auto-migrate-*` branches)

A future enhancement: a weekly cron at `/api/cron/prune-snapshots`
that calls the Neon delete-branch API for each snapshot older than
`SNAPSHOT_RETENTION_DAYS` (env-configurable). Out of scope for the
initial BL-QC-auto-migrate PR.

## Neon PITR (fallback when snapshots aren't configured)

Neon's Pro plan includes 7-day point-in-time recovery without any
explicit snapshot. To use:

1. Neon console → Project → **Restore**
2. Pick a target timestamp (just before the bad apply)
3. **Restore to a new branch** (recommended — gives you a side-by-side
   comparison before swapping primary) or **Restore in place**
   (faster but loses all changes since the target time)
4. Promote the restored branch to primary (Vercel reconnects on next
   boot)

PITR is fine for emergencies but explicit snapshots are preferred
because (a) they're tagged with the apply timestamp, (b) they don't
roll back unrelated user data between the apply and "now."

## Disabling auto-apply temporarily

Set `DISABLE_AUTO_MIGRATE=1` in Vercel env. Useful for:

- Forensic investigation after a failed apply (you want to inspect
  the half-migrated state without auto-apply trying to "fix" it on
  every cold start)
- Coordinated multi-environment rollouts where you apply migrations
  in a specific order across staging → preview → production
- Emergency freeze while you make a manual repair via `psql`

After the override is set:

- Cold start logs `[auto-migrate] skipped — DISABLE_AUTO_MIGRATE=1 set`
- `/admin/migrations` UI shows "Auto-apply: Disabled (env override)"
- Manual apply via the UI still works

Remember to unset the env var after the issue is resolved, or you
silently lose protection against future drift.

## Operator setup checklist

To get full benefit of the auto-apply + snapshot pipeline:

1. ✅ **`outputFileTracingIncludes`** for `drizzle/*.sql` in
   `next.config.mjs` — already set. Migrations need to be bundled into
   the Vercel function for the runner to find them.

2. ⏳ **`NEON_API_KEY`** in Vercel env — same key used for per-PR Neon
   branch lifecycle (`.github/workflows/neon-branch.yml`). Production
   scope.

3. ⏳ **`NEON_PROJECT_ID`** in Vercel env — your Neon project's id.

4. ⏳ **`NEON_BRANCH_PARENT`** (optional) — defaults to `main`. Set
   only if your Neon primary branch has a different name.

5. ⏳ **Snapshot retention plan** — decide whether you'll prune
   `auto-migrate-*` branches manually or build the prune cron. Out of
   scope for the initial PR; flagged in BACKLOG.

## Audit trail

Each apply is recorded in two places:

- **`_forge_migration` ledger** in Postgres — filename + sha256 +
  applied_at timestamp
- **Vercel logs** — structured `[auto-migrate]` entries with the
  applied filenames + the snapshot id (if taken)

Neither place captures *who* triggered the apply because auto-apply
runs without a session context. Manual applies via `/admin/migrations`
do record the actor in the audit log (BL-12 audit infrastructure).
