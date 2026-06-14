/**
 * Sentry browser-side configuration.
 *
 * Loaded by `@sentry/nextjs` automatically on every page render.
 * Errors caught here:
 *   - Uncaught exceptions in client components
 *   - Unhandled promise rejections in the browser
 *   - React error-boundary catches (when wired)
 *
 * Cost-conscious settings (free-tier 5k errors/mo):
 *   - tracesSampleRate: 0   → no performance monitoring (separate quota)
 *   - replaysSessionSampleRate: 0 → no session replays (paid + privacy)
 *   - replaysOnErrorSampleRate: 0 → not even on errors
 *
 * Set NEXT_PUBLIC_SENTRY_DSN in Vercel env to activate. When unset the
 * SDK no-ops cleanly — useful for local dev + previews that don't need
 * to consume quota.
 */

import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || "development",
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    // Don't capture noise: aborted fetches, expected auth redirects,
    // ResizeObserver loop warnings, browser-extension errors.
    ignoreErrors: [
      "AbortError",
      "NEXT_REDIRECT",
      "NEXT_NOT_FOUND",
      /ResizeObserver loop/i,
      /chrome-extension:/,
      /moz-extension:/,
    ],
  });
}
