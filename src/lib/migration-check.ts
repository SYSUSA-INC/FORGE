import { sql } from "drizzle-orm";
import { db } from "@/db";
import { log } from "@/lib/log";

/**
 * Boot-time check that the DB schema matches what the deployed app
 * expects. Cheap query — confirms `_forge_migration` exists and
 * the most-recent expected migration is recorded.
 *
 * Called once from `src/instrumentation.ts` after env validation.
 *
 * Doesn't throw — logs a loud error if schema is behind. The
 * primary defense is the build-time migration (package.json
 * `build` runs `apply-schema.mjs` first), but if that's bypassed
 * we want a clear log so the cause is obvious in Vercel's
 * function logs rather than mysterious 500s on table queries.
 *
 * Bumping `EXPECTED_LATEST_MIGRATION` is part of the workflow when
 * adding a new drizzle/0NNN migration file. The build will fail
 * loudly if forgotten.
 */
const EXPECTED_LATEST_MIGRATION = "0034_audit_log.sql";

let didCheck = false;

export async function verifyMigrationsOrWarn(): Promise<void> {
  if (didCheck) return;
  didCheck = true;

  if (!process.env.DATABASE_URL) {
    // Already flagged by validateEnvOrWarn; nothing useful to add.
    return;
  }

  try {
    // Does the ledger exist?
    const ledgerExists = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = '_forge_migration'
      ) AS exists
    `);

    const exists = (ledgerExists.rows?.[0] as { exists?: boolean })?.exists;
    if (!exists) {
      log.error(
        "[migration-check]",
        "Migration ledger table missing — schema has never been initialized. Sign in as super-admin and click /admin/migrations to apply.",
        { expectedLatest: EXPECTED_LATEST_MIGRATION },
      );
      return;
    }

    // Is the latest expected migration recorded?
    const latestRow = await db.execute(sql`
      SELECT filename FROM "_forge_migration"
      WHERE filename = ${EXPECTED_LATEST_MIGRATION}
      LIMIT 1
    `);

    if (latestRow.rows.length === 0) {
      log.error(
        "[migration-check]",
        "DB is behind the deployed code — latest migration not applied. Sign in as super-admin and click /admin/migrations to apply pending migrations.",
        { expectedLatest: EXPECTED_LATEST_MIGRATION },
      );
      return;
    }

    log.info("[migration-check]", "schema in sync", {
      latest: EXPECTED_LATEST_MIGRATION,
    });
  } catch (err) {
    // Don't bring down the boot for a check failure. Log and move on.
    log.warn("[migration-check]", "could not verify schema state", {
      error: err,
    });
  }
}
