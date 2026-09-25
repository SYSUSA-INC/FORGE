/**
 * BL-AIP-4 — retry policy for the background proposal health scan.
 *
 * Before this the cron retried a failing proposal every five minutes
 * forever (oldest-dirty first, five per run), so one proposal whose scan
 * kept failing blocked the queue and burned a request slot each tick.
 * Failures now back off exponentially and the proposal is dropped from
 * the queue after a handful of attempts. Pure; unit-tested.
 */

export const SCAN_MAX_ATTEMPTS = 5;
export const SCAN_BASE_BACKOFF_MS = 5 * 60_000;
export const SCAN_MAX_BACKOFF_MS = 6 * 60 * 60_000;

/** Delay before the next try after `attempts` failures (attempts ≥ 1). */
export function scanBackoffMs(attempts: number): number {
  const n = Math.max(1, Math.floor(attempts));
  return Math.min(SCAN_MAX_BACKOFF_MS, SCAN_BASE_BACKOFF_MS * 2 ** (n - 1));
}

/**
 * Given the failure count *including* the one that just happened,
 * decide whether to give up or when to try again.
 */
export function nextScanAttempt(
  attempts: number,
  now: Date = new Date(),
): { giveUp: boolean; nextAttemptAt: Date | null } {
  if (attempts >= SCAN_MAX_ATTEMPTS) return { giveUp: true, nextAttemptAt: null };
  return {
    giveUp: false,
    nextAttemptAt: new Date(now.getTime() + scanBackoffMs(attempts)),
  };
}
