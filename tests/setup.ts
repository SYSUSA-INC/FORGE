/**
 * BL-19 Phase 2 — global test setup.
 *
 * Hard-refuses to run against any database that looks like a real
 * production target. Tests INSERT and DELETE real rows; an
 * accidentally pointed-at production would corrupt data.
 *
 * Rules:
 *   - DATABASE_URL must be set
 *   - NODE_ENV must not be "production"
 *   - DATABASE_URL must NOT contain "prod" in the host or db name
 *
 * If you need to override these guards (e.g. to test against a Neon
 * branch named `prod-something`), set `FORGE_TEST_ALLOW_ANY_DB=1` —
 * but please don't do that against production.
 */

const url = process.env.DATABASE_URL ?? "";
if (!url) {
  throw new Error(
    "[tests/setup] DATABASE_URL is required. Set it to a test Postgres before running tests.",
  );
}

if (process.env.NODE_ENV === "production") {
  throw new Error(
    "[tests/setup] Refusing to run tests with NODE_ENV=production.",
  );
}

if (!process.env.FORGE_TEST_ALLOW_ANY_DB) {
  const lower = url.toLowerCase();
  if (
    /(\b|[-_])prod(\b|[-_])/.test(lower) ||
    /production/.test(lower)
  ) {
    throw new Error(
      `[tests/setup] DATABASE_URL contains "prod" — refusing to run tests. ` +
        `Set FORGE_TEST_ALLOW_ANY_DB=1 to override if you really mean this.`,
    );
  }
}
