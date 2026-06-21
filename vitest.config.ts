import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * BL-19 Phase 2 — Vitest config for runtime isolation tests.
 *
 * Tests live under `tests/`. They exercise real DB queries against the
 * Postgres pointed to by DATABASE_URL — typically the same dev DB used
 * by `npm run dev`, or in CI the ephemeral pgvector service that the
 * migration-verification job spins up.
 *
 * `forceRerunTriggers` is empty by default; vitest watches the test
 * files and the source modules they import.
 *
 * Single fork by default — tests share a Postgres pool and the
 * setup/teardown helpers manage fixture lifetimes. Parallel forks
 * would need per-test connection strings.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Stub Next.js server-side guards so server modules can be imported
      // in a Node/vitest context without throwing.
      "server-only": path.resolve(__dirname, "tests/mocks/server-only.ts"),
      "next/headers": path.resolve(__dirname, "tests/mocks/next-headers.ts"),
      "next/cache": path.resolve(__dirname, "tests/mocks/next-cache.ts"),
    },
  },
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
