import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { log } from "@/lib/log";

/**
 * Runtime migration runner — same logic as scripts/apply-schema.mjs
 * but invokable from the running Next.js server. Used by the
 * "Run migrations" admin action so an operator can apply pending
 * migrations against a deployed database with one click instead
 * of needing terminal access.
 *
 * Reads SQL files from the deployed function's `drizzle/` folder.
 * Vercel only includes those files because of `outputFileTracingIncludes`
 * in next.config.mjs — without that, Next.js would strip the folder
 * during bundling.
 *
 * Each migration applies inside a transaction. The `_forge_migration`
 * ledger gets the row in the same transaction so visibility is
 * atomic.
 *
 * Bootstrap-friendly: tolerates pre-ledger DBs by treating PG
 * duplicate-object errors as no-ops on the first recorded run.
 */

export type MigrationResult = {
  ok: true;
  appliedFilenames: string[];
  skippedFilenames: string[];
};

export type MigrationError = {
  ok: false;
  error: string;
  appliedFilenames: string[];
};

const DUPLICATE_PG_CODES = new Set([
  "42P07", // duplicate_table
  "42710", // duplicate_object (enum, constraint)
  "42701", // duplicate_column
  "42P06", // duplicate_schema
  "42723", // duplicate_function
]);

export async function runMigrations(): Promise<
  MigrationResult | MigrationError
> {
  const dir = join(process.cwd(), "drizzle");
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  } catch (err) {
    log.error("[migration-runner]", "drizzle/ directory not bundled", { error: err });
    return {
      ok: false,
      error:
        "Migration files not bundled into the server function. Confirm next.config.mjs includes outputFileTracingIncludes for drizzle/*.sql, then redeploy.",
      appliedFilenames: [],
    };
  }

  if (files.length === 0) {
    return {
      ok: false,
      error: "No .sql files found in drizzle/ — bundle issue.",
      appliedFilenames: [],
    };
  }

  // Ensure ledger exists before we look at it.
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "_forge_migration" (
        "filename" text PRIMARY KEY,
        "sha256" text NOT NULL,
        "applied_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Could not create migration ledger: ${err.message}`
          : "Could not create migration ledger.",
      appliedFilenames: [],
    };
  }

  // Pull existing ledger entries.
  const ledgerResult = await db.execute(
    sql`SELECT filename, sha256 FROM "_forge_migration"`,
  );
  const applied = new Map<string, string>();
  for (const row of ledgerResult.rows as { filename: string; sha256: string }[]) {
    applied.set(row.filename, row.sha256);
  }

  const appliedFilenames: string[] = [];
  const skippedFilenames: string[] = [];

  for (const file of files) {
    const path = join(dir, file);
    let content: string;
    try {
      content = readFileSync(path, "utf-8");
    } catch (err) {
      return {
        ok: false,
        error: `Could not read ${file}: ${err instanceof Error ? err.message : "unknown"}`,
        appliedFilenames,
      };
    }

    const hash = createHash("sha256").update(content).digest("hex");
    const recorded = applied.get(file);

    if (recorded) {
      if (recorded !== hash) {
        return {
          ok: false,
          error:
            `Migration ${file} has been edited after apply. ` +
            `Recorded sha256: ${recorded.slice(0, 12)}…, current: ${hash.slice(0, 12)}…. ` +
            `Migrations are immutable once applied — create a new migration file instead.`,
          appliedFilenames,
        };
      }
      skippedFilenames.push(file);
      continue;
    }

    const statements = content
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    let stmtsRun = 0;
    let stmtsSkipped = 0;

    try {
      // BEGIN/COMMIT semantics across Drizzle's exec wrapper. We
      // can't easily use db.transaction() because Neon's pgbouncer
      // proxy breaks long-running transactions; sequential exec
      // with manual rollback on first failure is safer here.
      await db.execute(sql.raw("BEGIN"));

      let aborted = false;
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        // SAVEPOINT per statement so the duplicate-skip below can
        // continue. Without a savepoint, a single failed statement
        // aborts the whole Postgres transaction — every subsequent
        // statement (including the ledger insert) returns
        // "current transaction is aborted". With a savepoint we
        // ROLLBACK TO it and the transaction stays healthy.
        const sp = `s${i}`;
        await db.execute(sql.raw(`SAVEPOINT ${sp}`));
        try {
          await db.execute(sql.raw(stmt));
          await db.execute(sql.raw(`RELEASE SAVEPOINT ${sp}`));
          stmtsRun += 1;
        } catch (err) {
          const code = (err as { code?: string }).code;
          if (code && DUPLICATE_PG_CODES.has(code)) {
            await db
              .execute(sql.raw(`ROLLBACK TO SAVEPOINT ${sp}`))
              .catch(() => undefined);
            stmtsSkipped += 1;
            continue;
          }
          await db.execute(sql.raw("ROLLBACK")).catch(() => undefined);
          aborted = true;
          return {
            ok: false,
            error:
              err instanceof Error
                ? `Failed applying ${file}: ${err.message}`
                : `Failed applying ${file}.`,
            appliedFilenames,
          };
        }
      }

      if (aborted) break;

      await db.execute(
        sql`INSERT INTO "_forge_migration" (filename, sha256) VALUES (${file}, ${hash})`,
      );
      await db.execute(sql.raw("COMMIT"));
      appliedFilenames.push(file);
      log.info("[migration-runner]", "applied", {
        filename: file,
        new: stmtsRun,
        skipped: stmtsSkipped,
      });
    } catch (err) {
      await db.execute(sql.raw("ROLLBACK")).catch(() => undefined);
      return {
        ok: false,
        error:
          err instanceof Error
            ? `Failed applying ${file}: ${err.message}`
            : `Failed applying ${file}.`,
        appliedFilenames,
      };
    }
  }

  return { ok: true, appliedFilenames, skippedFilenames };
}

/**
 * Quick read of the ledger so the admin UI can render
 * "schema in sync" / "N migrations pending" without firing the
 * full apply.
 */
export async function getMigrationStatus(): Promise<{
  expectedFiles: string[];
  appliedFiles: string[];
  pendingFiles: string[];
}> {
  const dir = join(process.cwd(), "drizzle");
  let expectedFiles: string[] = [];
  try {
    expectedFiles = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    return { expectedFiles: [], appliedFiles: [], pendingFiles: [] };
  }

  let appliedFiles: string[] = [];
  try {
    const result = await db.execute(
      sql`SELECT filename FROM "_forge_migration" ORDER BY filename`,
    );
    appliedFiles = (result.rows as { filename: string }[]).map((r) => r.filename);
  } catch {
    // Ledger doesn't exist yet — pretend nothing is applied.
  }

  const appliedSet = new Set(appliedFiles);
  const pendingFiles = expectedFiles.filter((f) => !appliedSet.has(f));

  return { expectedFiles, appliedFiles, pendingFiles };
}

/**
 * BL-QC-auto-migrate — detect destructive SQL operations.
 *
 * Auto-apply REFUSES to run a pending migration whose content matches
 * any of these patterns. The operator must apply such migrations
 * manually via `/admin/migrations` with an explicit confirmation.
 *
 * Rationale: data loss is permanent. Auto-applying a migration that
 * drops a column or table can take down production in seconds with
 * no easy undo. Catching it pre-apply forces a human review.
 *
 * Patterns we flag (data destruction, not perf/semantics):
 *   - DROP TABLE / COLUMN / TYPE / DATABASE / SCHEMA
 *   - TRUNCATE
 *   - ALTER COLUMN ... (SET DATA) TYPE (re-type can lose precision / fail)
 *
 * Patterns we do NOT flag:
 *   - DROP INDEX  (perf hit, recoverable by re-creating)
 *   - DROP CONSTRAINT  (semantics change, no data loss)
 *   - ADD/CREATE anything
 *   - INSERT / UPDATE / DELETE  (row-level — trusted to be reviewed)
 */
const DESTRUCTIVE_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: "DROP TABLE", regex: /\bDROP\s+TABLE\b/i },
  { name: "DROP COLUMN", regex: /\bDROP\s+COLUMN\b/i },
  { name: "DROP TYPE", regex: /\bDROP\s+TYPE\b/i },
  { name: "DROP DATABASE", regex: /\bDROP\s+DATABASE\b/i },
  { name: "DROP SCHEMA", regex: /\bDROP\s+SCHEMA\b/i },
  { name: "TRUNCATE", regex: /\bTRUNCATE\b/i },
  {
    name: "ALTER COLUMN TYPE",
    regex: /\bALTER\s+COLUMN\s+\S+\s+(?:SET\s+DATA\s+)?TYPE\b/i,
  },
];

export type DestructiveFinding = {
  filename: string;
  matches: string[]; // human-readable list of destructive op names
};

/**
 * Scan a migration file's content for destructive ops. Strips
 * comments before scanning so a "DROP TABLE foo" inside a `--` line
 * doesn't trigger a false positive.
 */
export function detectDestructiveOps(content: string): string[] {
  // Strip both `--` line comments and `/* */` block comments.
  const stripped = content
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const matches: string[] = [];
  for (const p of DESTRUCTIVE_PATTERNS) {
    if (p.regex.test(stripped)) matches.push(p.name);
  }
  return matches;
}

/**
 * Read pending migration files and return any that contain
 * destructive operations. Used by auto-apply to refuse, and by the
 * admin UI to surface a warning panel.
 */
export async function scanPendingForDestructive(): Promise<DestructiveFinding[]> {
  const status = await getMigrationStatus();
  const findings: DestructiveFinding[] = [];
  const dir = join(process.cwd(), "drizzle");
  for (const file of status.pendingFiles) {
    try {
      const content = readFileSync(join(dir, file), "utf-8");
      const matches = detectDestructiveOps(content);
      if (matches.length > 0) findings.push({ filename: file, matches });
    } catch {
      // If we can't read the file, leave it alone — runMigrations()
      // will surface the read error.
    }
  }
  return findings;
}

/**
 * Postgres advisory-lock key for single-flight migration apply.
 * Picked arbitrarily; just needs to be unique within the database.
 * If two server processes both try to auto-apply at cold start, only
 * one acquires the lock — the other returns immediately.
 */
const ADVISORY_LOCK_KEY = 7240613514;

export type AutoApplyResult =
  | {
      kind: "ok";
      appliedFilenames: string[];
      skippedFilenames: string[];
      snapshotId: string | null;
    }
  | { kind: "no-pending" }
  | {
      kind: "blocked-destructive";
      blockers: DestructiveFinding[];
    }
  | { kind: "lock-held" }
  | { kind: "disabled" }
  | { kind: "failed"; error: string; snapshotId: string | null };

/**
 * Cold-start hook for auto-applying pending migrations.
 *
 * Flow:
 *   1. Bail if DISABLE_AUTO_MIGRATE env var is set
 *   2. Bail if no pending migrations
 *   3. Bail if any pending migration contains destructive ops
 *   4. Acquire Postgres advisory lock (single-flight)
 *   5. Take Neon branch snapshot (if NEON_API_KEY is configured)
 *   6. Run runMigrations()
 *   7. Release lock
 *
 * Never throws. All failure modes return a structured AutoApplyResult
 * so the caller (instrumentation.ts) can log appropriately without
 * blocking server boot.
 */
export async function tryAutoApplyMigrations(): Promise<AutoApplyResult> {
  if (process.env.DISABLE_AUTO_MIGRATE === "1") {
    return { kind: "disabled" };
  }

  let status;
  try {
    status = await getMigrationStatus();
  } catch (err) {
    return {
      kind: "failed",
      error: `Could not read migration status: ${err instanceof Error ? err.message : "unknown"}`,
      snapshotId: null,
    };
  }

  if (status.pendingFiles.length === 0) {
    return { kind: "no-pending" };
  }

  const blockers = await scanPendingForDestructive();
  if (blockers.length > 0) {
    return { kind: "blocked-destructive", blockers };
  }

  // Try to acquire the advisory lock. pg_try_advisory_lock returns
  // immediately — true if we got it, false if another process holds
  // it. Non-blocking: a second cold-start instance just sees
  // "lock-held" and exits, letting the first one finish.
  const lockResult = await db.execute(
    sql`SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}) AS got`,
  );
  const got = (lockResult.rows[0] as { got?: boolean } | undefined)?.got;
  if (!got) {
    return { kind: "lock-held" };
  }

  let snapshotId: string | null = null;
  try {
    // Try to snapshot before applying. If Neon API isn't configured
    // or the call fails, we LOG and continue — snapshotting is
    // best-effort, not a blocker. The user can also take a manual
    // snapshot via the Neon dashboard.
    const { tryCreateBranchSnapshot } = await import("./neon-snapshot");
    snapshotId = await tryCreateBranchSnapshot(
      `auto-migrate-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`,
    );

    const result = await runMigrations();
    if (!result.ok) {
      return { kind: "failed", error: result.error, snapshotId };
    }
    return {
      kind: "ok",
      appliedFilenames: result.appliedFilenames,
      skippedFilenames: result.skippedFilenames,
      snapshotId,
    };
  } catch (err) {
    return {
      kind: "failed",
      error: err instanceof Error ? err.message : "unknown apply failure",
      snapshotId,
    };
  } finally {
    await db
      .execute(sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`)
      .catch(() => undefined);
  }
}

export type MarkAppliedResult =
  | { ok: true; markedFilenames: string[]; alreadyPresentFilenames: string[] }
  | { ok: false; error: string };

/**
 * BL-QC-ledger-drift-detector — surface "ledger says applied but
 * target table missing" drift.
 *
 * Scans every ledger entry, parses the migration file for
 * `CREATE TABLE [IF NOT EXISTS] "?<name>"?` statements, and checks
 * `information_schema.tables` for each name. Returns the list of
 * (migration, missing_table) pairs.
 *
 * Read-only. Called from `instrumentation.ts` on boot — logs a
 * loud warn when drift is detected so the operator sees it in
 * Vercel logs instead of waiting for the next 500.
 *
 * Why this exists: the 2026-06-15 incident (BL-QC-schema-repair)
 * surfaced after `/admin/orgs/[id]` started returning 500. We had
 * NO boot-time signal for the drift even though it was present
 * for days. Detector would have flagged it on the next cold start.
 */
export type LedgerDriftFinding = {
  filename: string;
  missingTables: string[];
};

const CREATE_TABLE_RE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi;

function tablesCreatedBy(content: string): string[] {
  // Strip comments first so commented-out CREATE TABLE in headers
  // doesn't yield false positives.
  const stripped = content
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const matches = new Set<string>();
  for (const m of stripped.matchAll(CREATE_TABLE_RE)) {
    const name = m[1];
    if (name && !name.startsWith("_forge_migration")) {
      matches.add(name);
    }
  }
  return [...matches];
}

export async function detectLedgerDrift(): Promise<LedgerDriftFinding[]> {
  let appliedLedger: { filename: string }[] = [];
  try {
    const result = await db.execute(
      sql`SELECT filename FROM "_forge_migration"`,
    );
    appliedLedger = result.rows as { filename: string }[];
  } catch {
    // Ledger doesn't exist yet — nothing to verify.
    return [];
  }
  if (appliedLedger.length === 0) return [];

  // Pull every table name once.
  let existingTables = new Set<string>();
  try {
    const tableResult = await db.execute(
      sql`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'`,
    );
    existingTables = new Set(
      (tableResult.rows as { tablename: string }[]).map((r) => r.tablename),
    );
  } catch (err) {
    log.warn("[ledger-drift]", "could not read pg_tables", { error: err });
    return [];
  }

  const dir = join(process.cwd(), "drizzle");
  const findings: LedgerDriftFinding[] = [];

  for (const row of appliedLedger) {
    let content: string;
    try {
      content = readFileSync(join(dir, row.filename), "utf-8");
    } catch {
      // Ledger references a file that no longer exists in the
      // bundle — separate problem, skip from drift report.
      continue;
    }
    const expectedTables = tablesCreatedBy(content);
    if (expectedTables.length === 0) continue;
    const missing = expectedTables.filter((t) => !existingTables.has(t));
    if (missing.length > 0) {
      findings.push({ filename: row.filename, missingTables: missing });
    }
  }

  return findings;
}

/**
 * Mark migration files as already-applied in the ledger **without
 * running their SQL**. Use case: a long-lived DB whose schema is
 * already in sync with the deployed code, but whose `_forge_migration`
 * ledger never got populated (e.g. earlier migrations were applied
 * via `scripts/apply-schema.mjs` or drizzle-kit before this runner
 * existed). After the sync, `runMigrations()` will skip the synced
 * files and only execute genuinely-new migrations.
 *
 * Operator picks an upper bound (`throughFilename`); every drizzle
 * .sql file with `filename <= throughFilename` that isn't already in
 * the ledger gets a row inserted with the file's current sha256.
 * Files **after** the bound are left untouched so the operator can
 * still apply them via `runMigrations()`.
 *
 * Idempotent — re-running on an already-synced ledger is a no-op.
 *
 * **Risk-bearing operation.** Caller must verify the deployed schema
 * actually matches the files being synced. Mis-syncing a file whose
 * SQL hasn't really been applied means the corresponding tables /
 * columns won't exist and queries will fail at runtime.
 */
export async function markMigrationsAppliedThrough(
  throughFilename: string,
): Promise<MarkAppliedResult> {
  const dir = join(process.cwd(), "drizzle");
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  } catch (err) {
    return {
      ok: false,
      error: `drizzle/ directory not readable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!files.includes(throughFilename)) {
    return {
      ok: false,
      error: `Upper bound '${throughFilename}' isn't an existing migration file.`,
    };
  }

  // Ensure ledger exists before we look at it.
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "_forge_migration" (
        "filename" text PRIMARY KEY,
        "sha256" text NOT NULL,
        "applied_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
  } catch (err) {
    return {
      ok: false,
      error: `Could not create migration ledger: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const ledgerResult = await db.execute(
    sql`SELECT filename FROM "_forge_migration"`,
  );
  const applied = new Set(
    (ledgerResult.rows as { filename: string }[]).map((r) => r.filename),
  );

  const eligible = files.filter((f) => f <= throughFilename);

  // BL-QC-ledger-drift-detector — refuse to mark a file applied if
  // the CREATE TABLE statements inside it reference tables that
  // don't exist in the database. This is the safety guard that
  // would have prevented the 2026-06-15 incident: if the operator
  // had clicked "Sync ledger" past a too-recent file, the underlying
  // tables wouldn't have existed → this guard refuses.
  let existingTables = new Set<string>();
  try {
    const tableResult = await db.execute(
      sql`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public'`,
    );
    existingTables = new Set(
      (tableResult.rows as { tablename: string }[]).map((r) => r.tablename),
    );
  } catch (err) {
    return {
      ok: false,
      error: `Could not read pg_tables to verify sync safety: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const safetyViolations: { file: string; missingTables: string[] }[] = [];
  for (const file of eligible) {
    if (applied.has(file)) continue;
    let content: string;
    try {
      content = readFileSync(join(dir, file), "utf-8");
    } catch {
      // Read error gets handled per-file below; skip safety check here.
      continue;
    }
    const expectedTables = tablesCreatedBy(content);
    const missing = expectedTables.filter((t) => !existingTables.has(t));
    if (missing.length > 0) {
      safetyViolations.push({ file, missingTables: missing });
    }
  }

  if (safetyViolations.length > 0) {
    const summary = safetyViolations
      .map((v) => `${v.file} (missing: ${v.missingTables.join(", ")})`)
      .join("; ");
    return {
      ok: false,
      error:
        `Refusing to sync ledger — ${safetyViolations.length} migration(s) ` +
        `create tables that don't exist in the database. Marking them as ` +
        `applied without running the SQL would leave the schema in a broken ` +
        `state (this is exactly the 2026-06-15 incident — see BL-QC-schema-repair). ` +
        `Apply the missing migrations first via runMigrations(), then retry sync. ` +
        `Violations: ${summary}`,
    };
  }

  const markedFilenames: string[] = [];
  const alreadyPresentFilenames: string[] = [];

  for (const file of eligible) {
    if (applied.has(file)) {
      alreadyPresentFilenames.push(file);
      continue;
    }
    let content: string;
    try {
      content = readFileSync(join(dir, file), "utf-8");
    } catch (err) {
      return {
        ok: false,
        error: `Could not read ${file}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    const hash = createHash("sha256").update(content).digest("hex");
    try {
      await db.execute(
        sql`INSERT INTO "_forge_migration" (filename, sha256) VALUES (${file}, ${hash}) ON CONFLICT (filename) DO NOTHING`,
      );
      markedFilenames.push(file);
    } catch (err) {
      return {
        ok: false,
        error: `Failed marking ${file}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  log.info("[migration-runner]", "marked-applied-through", {
    through: throughFilename,
    marked: markedFilenames.length,
    alreadyPresent: alreadyPresentFilenames.length,
  });

  return { ok: true, markedFilenames, alreadyPresentFilenames };
}
