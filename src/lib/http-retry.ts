/**
 * BL-AIX Phase 1a — every model and embedding call gets a deadline and
 * retries.
 *
 * Before this a provider 429 / 529 (rate limit, overload) or a 5xx
 * reached the user as a failed draft, and a hung call was killed by the
 * function limit: no ledger row was written and no quota refunded. Now:
 *   - each attempt has a deadline for the response to START (headers);
 *     a streaming body may then run as long as it needs;
 *   - 408 / 409 / 425 / 429 / 5xx / 529 and network errors retry with
 *     jittered exponential backoff, honouring `retry-after`, inside a
 *     total budget that stays under the function limit;
 *   - a deadline miss is not retried (another full wait would not fit)
 *     and surfaces as a clear error the gateway records and refunds.
 */

export const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 20_000;
const MAX_RETRY_AFTER_MS = 30_000;

/**
 * Wait before attempt `attempt + 1` (attempt ≥ 1 is the one that just
 * failed). `retry-after` (seconds or an HTTP date) wins when present;
 * otherwise full-jitter exponential backoff.
 */
export function retryDelayMs(attempt: number, retryAfter: string | null, rand: () => number = Math.random, now: number = Date.now()): number {
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1_000, MAX_RETRY_AFTER_MS);
    const at = Date.parse(retryAfter);
    if (!Number.isNaN(at)) return Math.min(Math.max(0, at - now), MAX_RETRY_AFTER_MS);
  }
  const cap = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (Math.max(1, attempt) - 1));
  return Math.floor(rand() * cap);
}

export class DeadlineError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} did not respond within ${Math.round(ms / 1000)}s.`);
    this.name = "DeadlineError";
  }
}

export type RetryOptions = {
  /** For error messages and logs, e.g. "Anthropic". */
  label: string;
  /** Deadline for the response headers of one attempt. */
  timeoutMs: number;
  maxAttempts?: number;
  /** Stop retrying once this much time has passed since the first attempt. */
  budgetMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  rand?: () => number;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * `fetch` with a per-attempt deadline and retries. Returns the last
 * response (callers keep their own `!res.ok` handling) or throws the
 * last network / deadline error.
 */
export async function fetchWithRetry(url: string, init: RequestInit, opts: RetryOptions): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const budgetMs = opts.budgetMs ?? 120_000;
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const startedAt = Date.now();

  for (let attempt = 1; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    let res: Response;
    try {
      res = await doFetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      if (controller.signal.aborted) throw new DeadlineError(opts.label, opts.timeoutMs);
      const delay = retryDelayMs(attempt, null, opts.rand);
      if (attempt >= maxAttempts || Date.now() - startedAt + delay > budgetMs) throw err;
      await sleep(delay);
      continue;
    }
    clearTimeout(timer);
    if (res.ok || !isRetryableStatus(res.status) || attempt >= maxAttempts) return res;
    const delay = retryDelayMs(attempt, res.headers.get("retry-after"), opts.rand);
    if (Date.now() - startedAt + delay > budgetMs) return res;
    await res.body?.cancel().catch(() => {});
    await sleep(delay);
  }
}
