/**
 * Next.js instrumentation hook — runs once per server process at boot.
 *
 * Use this for one-time, server-only setup that should run before the
 * first request. We use it to validate env vars; future additions
 * (Sentry init, OpenTelemetry, etc.) belong here too.
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnvOrWarn } = await import("./lib/env-check");
    validateEnvOrWarn();
  }
}
