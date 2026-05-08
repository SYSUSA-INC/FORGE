/**
 * Next.js instrumentation hook — runs once per server process at boot.
 *
 * Use this for one-time, server-only setup that should run before the
 * first request. We use it to validate env vars and confirm the DB
 * schema is in sync with the deployed code. Future additions
 * (Sentry init, OpenTelemetry, etc.) belong here too.
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnvOrWarn } = await import("./lib/env-check");
    validateEnvOrWarn();

    // Schema check runs after env validation so the DB connection
    // step doesn't trip when DATABASE_URL is missing.
    if (process.env.DATABASE_URL) {
      const { verifyMigrationsOrWarn } = await import(
        "./lib/migration-check"
      );
      // Fire-and-forget — never block boot on the DB roundtrip.
      // Errors are logged inside the function.
      void verifyMigrationsOrWarn();
    }
  }
}
