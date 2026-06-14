/**
 * Next.js instrumentation hook — runs once per server process at boot.
 *
 * Use this for one-time, server-only setup that should run before the
 * first request. We use it to:
 *   1. Validate env vars
 *   2. Confirm the DB schema is in sync with the deployed code
 *   3. Initialize Sentry on Node.js + Edge runtimes
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

    // Sentry server-side initialization. The config file no-ops when
    // SENTRY_DSN / NEXT_PUBLIC_SENTRY_DSN isn't set, so this import is
    // safe in environments without Sentry configured.
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

// Re-export Sentry's request-error hook so Next.js wires it
// automatically — captures errors thrown from server actions, route
// handlers, and RSC that would otherwise be invisible.
export { captureRequestError as onRequestError } from "@sentry/nextjs";
