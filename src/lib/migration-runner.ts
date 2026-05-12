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

export type MarkAppliedResult =
  | { ok: true; markedFilenames: string[]; alreadyPresentFilenames: string[] }
  | { ok: false; error: string };

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
