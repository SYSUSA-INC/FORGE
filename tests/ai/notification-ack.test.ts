/**
 * BL-AIP-3 — reading the inbox acknowledges deliveries so SLA breaches
 * stop firing for notifications the recipient has already seen.
 */

import { describe, expect, it } from "vitest";
import { ACK_GRACE_MS, ackCutoff } from "@/lib/notification-ack";

describe("ackCutoff", () => {
  it("returns null when nothing usable was read", () => {
    expect(ackCutoff([])).toBeNull();
    expect(ackCutoff([null, undefined, "not a date"])).toBeNull();
  });

  it("uses the newest timestamp plus the grace window", () => {
    const older = new Date("2026-09-24T10:00:00Z");
    const newer = new Date("2026-09-24T10:05:00Z");
    const cutoff = ackCutoff([older, newer, null]);
    expect(cutoff?.getTime()).toBe(newer.getTime() + ACK_GRACE_MS);
  });

  it("accepts ISO strings and a custom grace", () => {
    const cutoff = ackCutoff(["2026-09-24T10:00:00Z"], 1_000);
    expect(cutoff?.toISOString()).toBe("2026-09-24T10:00:01.000Z");
  });

  it("skips invalid entries without discarding the valid ones", () => {
    const valid = new Date("2026-09-24T09:00:00Z");
    const cutoff = ackCutoff(["garbage", valid], 0);
    expect(cutoff?.getTime()).toBe(valid.getTime());
  });
});
