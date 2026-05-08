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

export default nextConfig;
