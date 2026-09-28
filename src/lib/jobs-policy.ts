/**
 * BL-AIP-4c — retry and stuck-row policy for durable background jobs.
 *
 * A job row is claimed (`queued` → `running`, attempts + 1) before its
 * handler runs. If the instance dies mid-run the row stays `running`
 * with nothing to finish it; the jobs cron treats any row running for
 * longer than JOB_STUCK_AFTER_MS as dead and either re-queues it or,
 * when its attempts are spent, marks it failed. A handler failure backs
 * off (1 → 5 → 15 minutes) until the cap. Pure; unit-tested.
 */

export const JOB_MAX_ATTEMPTS = 3;
/** A run longer than this has died with its instance (Vercel caps at 5 min). */
export const JOB_STUCK_AFTER_MS = 15 * 60_000;
export const JOB_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;

/** Delay before the next try after `attempts` failures (attempts ≥ 1). */
export function jobBackoffMs(attempts: number): number {
  const n = Math.max(1, Math.floor(attempts));
  return JOB_BACKOFF_MS[Math.min(n, JOB_BACKOFF_MS.length) - 1]!;
}

/**
 * Given the attempt count *including* the one that just failed, decide
 * whether to give up or when to try again.
 */
export function nextJobAttempt(
  attempts: number,
  maxAttempts: number = JOB_MAX_ATTEMPTS,
  now: Date = new Date(),
): { giveUp: boolean; nextAttemptAt: Date | null } {
  if (attempts >= maxAttempts) return { giveUp: true, nextAttemptAt: null };
  return { giveUp: false, nextAttemptAt: new Date(now.getTime() + jobBackoffMs(attempts)) };
}

/** True when a `running` row started long enough ago to be presumed dead. */
export function jobIsStuck(startedAt: Date | null, now: Date = new Date()): boolean {
  if (!startedAt) return true;
  return now.getTime() - startedAt.getTime() >= JOB_STUCK_AFTER_MS;
}

/**
 * What the cron does with a stuck row: re-queue it for an immediate
 * retry while attempts remain, otherwise fail it. The claim already
 * counted the attempt that died, so a row at the cap is spent.
 */
export function resolveStuckJob(
  attempts: number,
  maxAttempts: number = JOB_MAX_ATTEMPTS,
): "queued" | "failed" {
  return attempts >= maxAttempts ? "failed" : "queued";
}

/** Human-readable status for the admin page and the tenant UI. */
export function describeJobStatus(job: {
  status: "queued" | "running" | "done" | "failed";
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  startedAt: Date | null;
}, now: Date = new Date()): string {
  switch (job.status) {
    case "done":
      return "done";
    case "failed":
      return `failed after ${job.attempts} attempt${job.attempts === 1 ? "" : "s"}`;
    case "running":
      return jobIsStuck(job.startedAt, now) ? "stuck (awaiting recovery)" : "running";
    case "queued":
      if (job.attempts === 0) return "queued";
      return job.nextAttemptAt.getTime() <= now.getTime()
        ? `retry due (attempt ${job.attempts + 1} of ${job.maxAttempts})`
        : `retry at ${job.nextAttemptAt.toISOString().slice(11, 16)} UTC (attempt ${job.attempts + 1} of ${job.maxAttempts})`;
  }
}
