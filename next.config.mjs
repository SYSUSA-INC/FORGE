import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Bundle the drizzle/*.sql migration files into the server
    // function so the runtime "Run migrations" admin action
    // (src/lib/migration-runner.ts) can read them via fs.
    // Without this trace include, Next.js would strip the folder
    // since no compiled code statically imports from it.
    outputFileTracingIncludes: {
      "/**/*": ["./drizzle/*.sql"],
    },
  },
};

// Sentry build-time options. These configure how the @sentry/nextjs
// plugin transforms the build, NOT the runtime SDK init (those live in
// sentry.{client,server,edge}.config.ts).
//
// When SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT are unset, the
// plugin still bundles the SDK but skips source-map upload + release
// creation. That's fine for dev / un-configured environments — runtime
// errors will still be captured client-side; the only loss is symbol
// resolution in the Sentry UI.
const sentryBuildOptions = {
  // The plugin reads these from env automatically; listed here only for
  // discoverability:
  //   - SENTRY_ORG          (Sentry org slug)
  //   - SENTRY_PROJECT      (Sentry project slug)
  //   - SENTRY_AUTH_TOKEN   (for source map upload — only needed in CI)
  silent: !process.env.CI, // suppress build-time logs locally
  widenClientFileUpload: true, // upload more sourcemaps for better stack traces
  tunnelRoute: "/monitoring", // proxy Sentry requests through our origin to avoid ad-blockers
  sourcemaps: { disable: true }, // keep source-maps off public Vercel deploys
  webpack: {
    // Free-tier-friendly: do NOT automatically instrument Vercel Cron Monitors
    // (paid feature). Strip Sentry's internal debug logger via treeshake to
    // shrink the bundle.
    automaticVercelMonitors: false,
    treeshake: { removeDebugLogging: true },
  },
};

export default withSentryConfig(nextConfig, sentryBuildOptions);
