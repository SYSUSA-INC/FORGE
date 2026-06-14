/**
 * Sentry Node.js (server) configuration.
 *
 * Loaded by `instrumentation.ts` on server-process boot. Errors caught
 * here:
 *   - Uncaught exceptions in server actions / route handlers
 *   - Unhandled promise rejections on the Node.js runtime
 *   - Errors thrown by RSC (React Server Components)
 *
 * NOT loaded by Edge runtime — see sentry.edge.config.ts for that.
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
    // Server-side noise we don't want eating quota:
    //   - Next.js framework signals (redirect / notFound throw values)
    //   - NextAuth's expected sign-in redirects
    ignoreErrors: [
      "NEXT_REDIRECT",
      "NEXT_NOT_FOUND",
      "NEXT_HTTP_ERROR_FALLBACK",
    ],
  });
}
