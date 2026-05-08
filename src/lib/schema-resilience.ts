import { log } from "@/lib/log";

/**
 * Detect Postgres "relation does not exist" / "type does not exist"
 * errors so pages that query newly-added tables can degrade
 * gracefully when migrations haven't yet caught up to the deployed
 * code. The build-time migration step
 * (`npm run build` → `apply-schema.mjs && next build`) prevents this
 * in normal operation, but defense-in-depth keeps the UI honest if
 * the migration ever gets bypassed.
 *
 * Usage:
 *
 *   const rows = await safeQuery(
 *     () => db.select().from(auditLogs).where(...),
 *     [],
 *   );
 *
 * Returns the fallback when the underlying error is a known schema-
 * sync issue. Re-throws everything else so genuine bugs still
 * surface.
 */

const SCHEMA_SYNC_PG_CODES = new Set([
  "42P01", // undefined_table
  "42704", // undefined_object (e.g. enum type missing)
  "42703", // undefined_column
]);

export async function safeQuery<T>(
  fn: () => Promise<T>,
  fallback: T,
  context?: { tag?: string },
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code && SCHEMA_SYNC_PG_CODES.has(code)) {
      log.error(
        "[schema-resilience]",
        "Query failed against missing table/type — DB is behind deployed code. Run `npm run db:apply` or redeploy with auto-migrate enabled.",
        {
          pgCode: code,
          tag: context?.tag,
          message: (err as Error).message,
        },
      );
      return fallback;
    }
    throw err;
  }
}

/**
 * True if the given error is a schema-sync / missing-table error.
 * Useful for callers that want to render a banner state in addition
 * to the fallback.
 */
export function isSchemaSyncError(err: unknown): boolean {
  const code = (err as { code?: string } | null | undefined)?.code;
  return !!code && SCHEMA_SYNC_PG_CODES.has(code);
}
