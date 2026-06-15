/**
 * Next.js instrumentation hook — runs once per server process at boot.
 *
 * Boot sequence (Node.js runtime):
 *   1. Validate required env vars
 *   2. Auto-apply pending migrations (BL-QC-auto-migrate)
 *      - Single-flight via Postgres advisory lock
 *      - Refuses destructive ops (DROP TABLE / COLUMN / TYPE, TRUNCATE,
 *        ALTER COLUMN TYPE) — manual /admin/migrations only
 *      - Takes a Neon branch snapshot if NEON_API_KEY is configured
 *      - Set DISABLE_AUTO_MIGRATE=1 to freeze the schema in place
 *   3. Verify the DB schema matches what the code expects (warn-only)
 *
 * **Webpack pruning requirement:** every dynamic import of a Node-only
 * module (migration-runner, migration-check, pg-via-db) MUST be
 * directly inside `if (process.env.NEXT_RUNTIME === "nodejs") { ... }`.
 * Wrapping in a top-level helper defeats Next.js's tree-shaking and
 * webpack traces pg into the Edge bundle, which then fails to resolve
 * `fs` / `path` / `stream`.
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *       docs/MIGRATION_PROTOCOL.md
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnvOrWarn } = await import("./lib/env-check");
    validateEnvOrWarn();

    if (process.env.DATABASE_URL) {
      // Auto-apply pending migrations. The dynamic imports stay inside
      // this conditional so webpack prunes them from the Edge bundle
      // (pg → fs/path/stream is incompatible with Edge runtime).
      //
      // Fire-and-forget so a slow apply (or a hung Neon snapshot
      // call) doesn't block the server from starting to serve
      // requests. Errors are logged inside the IIFE.
      void (async () => {
        const { log } = await import("./lib/log");
        try {
          const { tryAutoApplyMigrations } = await import(
            "./lib/migration-runner"
          );
          const result = await tryAutoApplyMigrations();
          switch (result.kind) {
            case "ok":
              if (result.appliedFilenames.length > 0) {
                log.info(
                  "[auto-migrate]",
                  `applied ${result.appliedFilenames.length} pending migration(s)`,
                  {
                    applied: result.appliedFilenames,
                    skipped: result.skippedFilenames,
                    snapshotId: result.snapshotId,
                  },
                );
              }
              break;
            case "no-pending":
              break;
            case "blocked-destructive":
              log.warn(
                "[auto-migrate]",
                "refused — pending migrations contain destructive ops; apply manually via /admin/migrations",
                { blockers: result.blockers },
              );
              break;
            case "lock-held":
              log.info(
                "[auto-migrate]",
                "advisory lock held by another instance",
              );
              break;
            case "disabled":
              log.info(
                "[auto-migrate]",
                "skipped — DISABLE_AUTO_MIGRATE=1 set",
              );
              break;
            case "failed":
              log.error(
                "[auto-migrate]",
                "failed to apply pending migrations",
                {
                  error: result.error,
                  snapshotId: result.snapshotId,
                },
              );
              break;
          }
        } catch (err) {
          log.error("[auto-migrate]", "unexpected error during auto-apply", {
            error: err,
          });
        }

        // Schema check runs after auto-apply so the warn reflects
        // post-apply state. If apply failed, the verify will surface
        // what columns/tables are still missing.
        try {
          const { verifyMigrationsOrWarn } = await import(
            "./lib/migration-check"
          );
          await verifyMigrationsOrWarn();
        } catch (err) {
          log.error("[migration-check]", "schema verify failed", {
            error: err,
          });
        }
      })();
    }
  }
}
