/**
 * BL-AIP-4 — background scan retry policy.
 */

import { describe, expect, it } from "vitest";
import {
  SCAN_BASE_BACKOFF_MS,
  SCAN_MAX_ATTEMPTS,
  SCAN_MAX_BACKOFF_MS,
  nextScanAttempt,
  scanBackoffMs,
} from "@/lib/proposal-scan-backoff";

describe("scanBackoffMs", () => {
  it("doubles from five minutes and caps at six hours", () => {
    expect(scanBackoffMs(1)).toBe(SCAN_BASE_BACKOFF_MS);
    expect(scanBackoffMs(2)).toBe(SCAN_BASE_BACKOFF_MS * 2);
    expect(scanBackoffMs(3)).toBe(SCAN_BASE_BACKOFF_MS * 4);
    expect(scanBackoffMs(20)).toBe(SCAN_MAX_BACKOFF_MS);
  });

  it("treats zero or negative attempts as the first failure", () => {
    expect(scanBackoffMs(0)).toBe(SCAN_BASE_BACKOFF_MS);
    expect(scanBackoffMs(-3)).toBe(SCAN_BASE_BACKOFF_MS);
  });
});

describe("nextScanAttempt", () => {
  const now = new Date("2026-09-25T10:00:00Z");

  it("schedules the retry until the attempt cap", () => {
    const first = nextScanAttempt(1, now);
    expect(first.giveUp).toBe(false);
    expect(first.nextAttemptAt?.toISOString()).toBe("2026-09-25T10:05:00.000Z");
    const third = nextScanAttempt(3, now);
    expect(third.nextAttemptAt?.toISOString()).toBe("2026-09-25T10:20:00.000Z");
  });

  it("gives up at the cap", () => {
    expect(nextScanAttempt(SCAN_MAX_ATTEMPTS, now)).toEqual({ giveUp: true, nextAttemptAt: null });
    expect(nextScanAttempt(SCAN_MAX_ATTEMPTS + 4, now).giveUp).toBe(true);
    expect(nextScanAttempt(SCAN_MAX_ATTEMPTS - 1, now).giveUp).toBe(false);
  });
});
