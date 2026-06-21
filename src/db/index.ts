import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Add it in Vercel env (Production + Preview + Development) or .env.local for local dev.",
  );
}

/**
 * Decide whether to ask `pg` for a TLS connection.
 *
 * Defaults that match how Postgres clients usually work:
 *   - `sslmode=disable` in the URL → no TLS (CI's local Postgres,
 *     dev containers that don't ship a cert)
 *   - `sslmode=require` / `verify-full` / `verify-ca` → TLS on
 *   - No sslmode → off for localhost / loopback, on everywhere else
 *     (Neon, RDS, GCP — all of which require it)
 *
 * `rejectUnauthorized: false` mirrors the historical FORGE behavior
 * for Neon, which uses publicly-signed but unmanaged certs.
 */
function shouldUseSsl(url: string): boolean {
  try {
    const u = new URL(url);
    const sslmode = u.searchParams.get("sslmode");
    if (sslmode === "disable") return false;
    if (
      sslmode === "require" ||
      sslmode === "verify-full" ||
      sslmode === "verify-ca"
    ) {
      return true;
    }
    const host = u.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return false;
    }
    return true;
  } catch {
    // If URL parsing fails, fall back to "yes" — safer default for the
    // primary use case (production Neon).
    return true;
  }
}

const globalForDb = globalThis as unknown as { __pgPool?: Pool };

const pool =
  globalForDb.__pgPool ??
  new Pool({
    connectionString,
    ...(shouldUseSsl(connectionString)
      ? { ssl: { rejectUnauthorized: false } }
      : {}),
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__pgPool = pool;
}

export const db = drizzle(pool, { schema });

export { schema };
