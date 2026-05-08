import { log } from "@/lib/log";

/**
 * Detect Postgres "relation does not exist" / "type does not exist"
 * errors so pages that query newly-added tables can degrade
 * gracefully when migrations haven't yet caught up to the deployed
 * code.
 *
 * Defense-in-depth — the primary fix is the runtime migration
 * runner at /admin/migrations. This wrapper keeps page renders
 * alive in the window between deploy and migration apply.
 *
 * Detection is deliberately broad because Postgres clients in this
 * stack (drizzle-orm, @neondatabase/serverless, pg) all wrap errors
 * differently. We check:
 *   1. Top-level `.code`
 *   2. `.cause.code` (Neon serverless wraps)
 *   3. Error message string for the canonical phrases
 *
 * Returns the fallback when the underlying error is a known schema-
 * sync issue. Re-throws everything else so genuine bugs still
 * surface.
 */

const SCHEMA_SYNC_PG_CODES = new Set([
  "42P01", // undefined_table
  "42704", // undefined_object (e.g. enum type missing)
  "42703", // undefined_column
  "3F000", // invalid_schema_name
]);

const SCHEMA_SYNC_MESSAGE_PATTERNS = [
  /relation .* does not exist/i,
  /column .* does not exist/i,
  /type .* does not exist/i,
  /schema .* does not exist/i,
];

function isSchemaSyncErrorObj(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; cause?: unknown; message?: string };

  // 1. Direct code match
  if (e.code && SCHEMA_SYNC_PG_CODES.has(e.code)) return true;

  // 2. Wrapped: check .cause recursively (Drizzle / Neon wrap pg errors).
  if (e.cause && isSchemaSyncErrorObj(e.cause)) return true;

  // 3. Message-string fallback. Brittle, but worth it as a last
  //    resort — without it, Drizzle's error swallowing on certain
  //    code paths can hide a missing table behind a cryptic
  //    "Internal Server Error".
  if (typeof e.message === "string") {
    for (const pat of SCHEMA_SYNC_MESSAGE_PATTERNS) {
      if (pat.test(e.message)) return true;
    }
  }

  return false;
}

export function isSchemaSyncError(err: unknown): boolean {
  return isSchemaSyncErrorObj(err);
}

export async function safeQuery<T>(
  fn: () => Promise<T>,
  fallback: T,
  context?: { tag?: string },
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isSchemaSyncErrorObj(err)) {
      log.error(
        "[schema-resilience]",
        "Query failed against missing table/type — DB is behind deployed code. Sign in as super-admin and click /admin/migrations to apply pending migrations.",
        {
          tag: context?.tag,
          message: err instanceof Error ? err.message : String(err),
          code: (err as { code?: string }).code,
        },
      );
      return fallback;
    }
    throw err;
  }
}
