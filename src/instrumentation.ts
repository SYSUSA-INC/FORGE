/**
 * Next.js instrumentation hook — runs once per server process at boot.
 *
 * **Prerequisite:** `experimental.instrumentationHook: true` in
 * next.config.mjs. On Next 14 the hook is opt-in; without the flag this
 * file is never loaded and none of the steps below run. That was the
 * state of production until BL-QC-boot-hook: no auto-apply, no schema
 * check, no env marker — the ledger sat at 0 of 76 files applied and
 * every page that read a newer column returned 500.
 *
 * Boot sequence (Node.js runtime; skipped during `next build`):
 *   1. Validate required env vars
 *   2. Auto-apply pending migrations (BL-QC-auto-migrate)
 *      - Awaited, with a time budget, so the first request is served
 *        against the schema the code expects — Next awaits `register()`
 *        before it handles traffic
 *      - Single-flight via a Postgres advisory lock on one pinned
 *        connection (lock, BEGIN/COMMIT and unlock share a session)
 *      - Refuses destructive ops (DROP TABLE / COLUMN / TYPE, TRUNCATE,
 *        ALTER COLUMN TYPE) — manual /admin/migrations only
 *      - Takes a Neon branch snapshot if NEON_API_KEY is configured
 *      - Set DISABLE_AUTO_MIGRATE=1 to freeze the schema in place
 *   3. Verify the DB schema matches what the code expects (warn-only)
 *   4. Ledger-drift detector (read-only)
 *   5. Environment marker — exits the process on a mismatch for
 *      production / staging / an operator override; preview and
 *      development runtimes only log, since their databases are copies
 *      of another environment's (BL-ENV-SEP)
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

/**
 * How long boot waits for the schema work before serving traffic anyway.
 * A normal deploy has zero or one pending migration and finishes well
 * under a second; the budget only matters for a large catch-up batch,
 * which then keeps running in the background and shows up on
 * /admin/migrations (and as a [migration-check] error on the next cold
 * start). Kept under Vercel's default function timeout so a slow apply
 * can never turn the first request into a 504.
 */
const BOOT_BUDGET_MS = (() => {
  const n = Number(process.env.AUTO_MIGRATE_BOOT_BUDGET_MS);
  return Number.isFinite(n) && n > 0 ? n : 8_000;
})();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    // Don't keep the process alive for the timer once boot work is done.
    if (typeof t === "object" && t && "unref" in t) t.unref();
  });
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // `next build` boots the Node runtime to prerender static routes and
    // would run everything below against the build's DATABASE_URL (a
    // stub in CI). Boot work belongs to the serving process only.
    if (process.env.NEXT_PHASE === "phase-production-build") return;

    const { validateEnvOrWarn } = await import("./lib/env-check");
    validateEnvOrWarn();

    if (process.env.DATABASE_URL) {
      const { log } = await import("./lib/log");

      // The dynamic imports stay inside this conditional so webpack
      // prunes them from the Edge bundle (pg → fs/path/stream is
      // incompatible with Edge runtime).
      const work = (async () => {
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
              // error, not warn: the schema is behind and only an
              // operator can move it. log.error is autocaptured into
              // /admin/errors so this cannot sit unnoticed in a log.
              log.error(
                "[auto-migrate]",
                "refused — pending migrations contain destructive ops; apply manually via /admin/migrations",
                { blockers: result.blockers },
              );
              break;
            case "lock-held":
              log.warn(
                "[auto-migrate]",
                `advisory lock held by another instance — leaving ${result.pending} pending migration(s) to it`,
                { pending: result.pending },
              );
              break;
            case "disabled":
              log.info(
                "[auto-migrate]",
                "skipped — DISABLE_AUTO_MIGRATE=1 set; pending migrations, if any, must be applied via /admin/migrations",
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

        // BL-QC-ledger-drift-detector — scan for "ledger says applied
        // but target table missing" drift. Read-only; logs a loud
        // error so operators see drift immediately instead of waiting
        // for the next 500. Triggered by the 2026-06-15 incident
        // (BL-QC-schema-repair).
        try {
          const { detectLedgerDrift } = await import(
            "./lib/migration-runner"
          );
          const drift = await detectLedgerDrift();
          if (drift.length > 0) {
            log.error(
              "[ledger-drift]",
              `detected ${drift.length} migration(s) with missing target tables — schema is in a partial state; apply the affected migrations or write a repair migration like 0052`,
              { drift },
            );
          }
        } catch (err) {
          log.warn("[ledger-drift]", "detector failed to run", {
            error: err,
          });
        }

        // BL-ENV-SEP — environment marker check. Compares the runtime's
        // VERCEL_ENV (or FORGE_ENV_OVERRIDE) to the marker stored in
        // `_forge_env`. A mismatch on production / staging / an override
        // means this deploy is pointed at the wrong DB (e.g. staging
        // Vercel project accidentally using prod DATABASE_URL) — CRASH
        // immediately. Better than silently corrupting prod data.
        try {
          const { verifyEnvMarker } = await import("./lib/env-marker");
          const result = await verifyEnvMarker();
          switch (result.kind) {
            case "ok":
              log.info("[env-marker]", "marker verified", {
                env: result.expected,
              });
              break;
            case "first-boot":
              log.info("[env-marker]", "first-boot marker recorded", {
                env: result.recorded,
              });
              break;
            case "skipped":
              log.info("[env-marker]", "skipped", { reason: result.reason });
              break;
            case "mismatch":
              if (result.enforce) {
                // HARD CRASH: this is exactly the scenario we built
                // this for. Refuse to serve a single request when
                // the env label doesn't match what the DB expects.
                log.error(
                  "[env-marker]",
                  "FATAL: env marker mismatch — refusing to start",
                  { expected: result.expected, current: result.current },
                );
                // SIGTERM the process so the platform restarts us (and
                // ideally the operator notices the crash loop).
                process.exit(1);
              }
              // Preview / development: the database is a copy of
              // another environment's and carries its marker.
              log.warn(
                "[env-marker]",
                `marker says ${result.expected}, runtime is ${result.current} — tolerated on a copied database`,
                { expected: result.expected, current: result.current },
              );
              break;
          }
        } catch (err) {
          log.warn("[env-marker]", "verifier failed to run", { error: err });
        }
      })();

      // Awaited — Next runs register() to completion before serving —
      // but bounded, so a huge catch-up batch degrades to "serve now,
      // finish in the background" instead of a timed-out first request.
      const finished = await Promise.race([
        work.then(
          () => true,
          () => true,
        ),
        sleep(BOOT_BUDGET_MS).then(() => false),
      ]);
      if (!finished) {
        log.error(
          "[boot]",
          `schema boot work still running after ${BOOT_BUDGET_MS}ms — serving traffic while it finishes in the background. If /admin/migrations shows pending files after this deploy, apply them there.`,
          { budgetMs: BOOT_BUDGET_MS },
        );
      }
    }
  }
}
