/**
 * Sentry Edge runtime configuration.
 *
 * Loaded by `instrumentation.ts` when NEXT_RUNTIME === "edge". The edge
 * runtime is used by middleware + any route handler that declares
 * `export const runtime = "edge"`. None of our routes do today, but the
 * middleware (NextAuth) runs on edge by default.
 *
 * Cost-conscious settings — see sentry.client.config.ts header.
 */

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV || "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: 0,
    ignoreErrors: [
      "NEXT_REDIRECT",
      "NEXT_NOT_FOUND",
      "NEXT_HTTP_ERROR_FALLBACK",
    ],
  });
}
