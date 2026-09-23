/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Load src/instrumentation.ts at server boot. On Next 14 this is
    // opt-in and defaults to false; without it the file is silently
    // ignored, which is how production ran for months with no
    // auto-migrate, no schema check and no env marker (BL-QC-boot-hook).
    // Pinned by tests/ai/instrumentation-hook.test.ts. Stable (and this
    // flag removed) in Next 15.
    instrumentationHook: true,
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

export default nextConfig;
