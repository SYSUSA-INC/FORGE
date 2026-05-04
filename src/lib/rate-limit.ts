/**
 * DB-backed rate limiter (audit PR-5).
 *
 * Pattern: fixed-window counters in `rate_limit_counter`. For each
 * (key, window_start) pair we INCR a count via UPSERT. The window
 * is computed as `floor(now() / windowSeconds) * windowSeconds`, so
 * all calls within the same window land on the same row.
 *
 * Why fixed window (not sliding):
 *   - One DB round trip per check.
 *   - Ceiling-effect at window boundaries is acceptable for our use
 *     cases (a user can briefly do 2× the limit if they straddle a
 *     boundary; we're protecting against orders-of-magnitude abuse,
 *     not optimizing fairness).
 *
 * Storage: Postgres. We can swap to Upstash/Redis later by re-
 * implementing this file's exports without changing call sites.
 *
 * Cleanup: rows older than 24h are stale and can be deleted by a
 * sweeper. Not implemented yet; the table grows ~ (active keys × 24)
 * rows per day in the worst case, which is tiny for our scale.
 *
 * Usage:
 *   const limit = await enforceRateLimit({
 *     key: `register:ip:${ip}`,
 *     limit: 5,
 *     windowSeconds: 3600,
 *   });
 *   if (!limit.ok) {
 *     return NextResponse.json(
 *       { ok: false, error: "Too many attempts. Try again shortly." },
 *       { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
 *     );
 *   }
 */
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { log } from "@/lib/log";

export type RateLimitOptions = {
  /**
   * Stable identifier for what's being limited. Format convention:
   * "<scope>:<dimension>:<value>", e.g. "register:ip:1.2.3.4",
   * "review:org:abc-uuid", "ai-draft:user:user-uuid". Keep under 256
   * chars (no DB enforcement, just sanity).
   */
  key: string;
  /** Maximum count permitted in the window. */
  limit: number;
  /**
   * Window length in seconds. Common values: 60 (per minute),
   * 3600 (per hour), 86400 (per day).
   */
  windowSeconds: number;
};

export type RateLimitOk = {
  ok: true;
  /** How many requests are still permitted in this window. */
  remaining: number;
  /** Seconds until the current window ends and the count resets. */
  resetIn: number;
};

export type RateLimitDenied = {
  ok: false;
  /** Seconds until the next request will be permitted. */
  retryAfter: number;
};

export type RateLimitResult = RateLimitOk | RateLimitDenied;

/**
 * Increment the counter for (key, current window) and return whether
 * the caller is within the limit.
 *
 * Failure mode: if the DB query throws (network blip, transient
 * Postgres error), we LOG the error and ALLOW the request. Fail-open
 * is intentional — rate limiting is a defense, and a broken rate
 * limiter shouldn't take down the entire endpoint. Real abuse will
 * recur and get caught on a working call.
 */
export async function enforceRateLimit(
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  if (opts.limit <= 0) {
    return { ok: false, retryAfter: opts.windowSeconds };
  }
  const now = Date.now();
  const windowMs = opts.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const resetIn = Math.max(
    1,
    Math.ceil((windowStart.getTime() + windowMs - now) / 1000),
  );

  try {
    const result = await db.execute<{ count: number }>(sql`
      INSERT INTO rate_limit_counter (key, window_start, count, updated_at)
      VALUES (${opts.key}, ${windowStart}, 1, now())
      ON CONFLICT (key, window_start)
      DO UPDATE SET
        count = rate_limit_counter.count + 1,
        updated_at = now()
      RETURNING count
    `);
    type Row = { count: number };
    const rows = ((result as unknown as { rows?: Row[] }).rows ??
      (result as unknown as Row[])) as Row[];
    const count = Number(rows[0]?.count ?? 0);
    if (count > opts.limit) {
      return { ok: false, retryAfter: resetIn };
    }
    return {
      ok: true,
      remaining: Math.max(0, opts.limit - count),
      resetIn,
    };
  } catch (err) {
    // Fail-open. Log and allow.
    log.error("[rate-limit]", "DB error, failing open", { error: err });
    return { ok: true, remaining: opts.limit, resetIn };
  }
}

/**
 * Best-effort extraction of the caller's IP from a Next.js request.
 * Used as the keying dimension for unauthenticated endpoints.
 *
 * Vercel sets `x-forwarded-for` (the first entry is the real client).
 * Falls back to the connection remote address when running locally.
 * If we can't determine an IP, returns "unknown" so the limiter
 * still functions (lumping all unknowns into one bucket).
 */
export function ipFromRequest(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}
