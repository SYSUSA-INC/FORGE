/**
 * BL-AIP-4c — retry and stuck-row policy for durable background jobs.
 */

import { describe, expect, it } from "vitest";
import {
  JOB_BACKOFF_MS,
  JOB_MAX_ATTEMPTS,
  JOB_STUCK_AFTER_MS,
  describeJobStatus,
  jobBackoffMs,
  jobIsStuck,
  nextJobAttempt,
  resolveStuckJob,
} from "@/lib/jobs-policy";

const now = new Date("2026-09-28T12:00:00Z");

describe("jobBackoffMs", () => {
  it("steps 1 → 5 → 15 minutes and holds at the last step", () => {
    expect(jobBackoffMs(1)).toBe(60_000);
    expect(jobBackoffMs(2)).toBe(5 * 60_000);
    expect(jobBackoffMs(3)).toBe(15 * 60_000);
    expect(jobBackoffMs(9)).toBe(JOB_BACKOFF_MS[JOB_BACKOFF_MS.length - 1]);
  });

  it("treats zero or negative attempts as the first failure", () => {
    expect(jobBackoffMs(0)).toBe(60_000);
    expect(jobBackoffMs(-2)).toBe(60_000);
  });
});

describe("nextJobAttempt", () => {
  it("schedules a retry until the cap", () => {
    expect(nextJobAttempt(1, JOB_MAX_ATTEMPTS, now)).toEqual({
      giveUp: false,
      nextAttemptAt: new Date("2026-09-28T12:01:00Z"),
    });
    expect(nextJobAttempt(2, JOB_MAX_ATTEMPTS, now).nextAttemptAt?.toISOString()).toBe(
      "2026-09-28T12:05:00.000Z",
    );
  });

  it("gives up at the cap, honouring a per-job cap", () => {
    expect(nextJobAttempt(JOB_MAX_ATTEMPTS, JOB_MAX_ATTEMPTS, now)).toEqual({
      giveUp: true,
      nextAttemptAt: null,
    });
    expect(nextJobAttempt(1, 1, now).giveUp).toBe(true);
    expect(nextJobAttempt(4, 5, now).giveUp).toBe(false);
  });
});

describe("jobIsStuck / resolveStuckJob", () => {
  it("presumes a run dead once it passes the window, or never started", () => {
    expect(jobIsStuck(null, now)).toBe(true);
    expect(jobIsStuck(new Date(now.getTime() - JOB_STUCK_AFTER_MS + 1000), now)).toBe(false);
    expect(jobIsStuck(new Date(now.getTime() - JOB_STUCK_AFTER_MS), now)).toBe(true);
  });

  it("re-queues while attempts remain and fails a spent row", () => {
    expect(resolveStuckJob(1, 3)).toBe("queued");
    expect(resolveStuckJob(2, 3)).toBe("queued");
    expect(resolveStuckJob(3, 3)).toBe("failed");
    expect(resolveStuckJob(5, 3)).toBe("failed");
  });
});

describe("describeJobStatus", () => {
  const base = { attempts: 0, maxAttempts: 3, nextAttemptAt: now, startedAt: null };

  it("names each state for people", () => {
    expect(describeJobStatus({ ...base, status: "queued" }, now)).toBe("queued");
    expect(describeJobStatus({ ...base, status: "done" }, now)).toBe("done");
    expect(describeJobStatus({ ...base, status: "failed", attempts: 1 }, now)).toBe(
      "failed after 1 attempt",
    );
    expect(describeJobStatus({ ...base, status: "failed", attempts: 3 }, now)).toBe(
      "failed after 3 attempts",
    );
    expect(
      describeJobStatus({ ...base, status: "running", startedAt: new Date(now.getTime() - 60_000) }, now),
    ).toBe("running");
    expect(
      describeJobStatus({ ...base, status: "running", startedAt: new Date(now.getTime() - 3_600_000) }, now),
    ).toBe("stuck (awaiting recovery)");
  });

  it("says when a retry is due", () => {
    expect(describeJobStatus({ ...base, status: "queued", attempts: 1 }, now)).toBe(
      "retry due (attempt 2 of 3)",
    );
    expect(
      describeJobStatus(
        { ...base, status: "queued", attempts: 2, nextAttemptAt: new Date("2026-09-28T12:05:00Z") },
        now,
      ),
    ).toBe("retry at 12:05 UTC (attempt 3 of 3)");
  });
});
