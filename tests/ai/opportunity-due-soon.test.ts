/**
 * BL-AIP-3 — the pure date math behind the `opportunity_due_soon`
 * trigger the daily cron now emits.
 */

import { describe, expect, it } from "vitest";
import {
  DUE_SOON_HORIZONS,
  daysUntil,
  dueSoonBody,
  dueSoonHorizon,
  dueSoonSubject,
} from "@/lib/opportunity-due-soon";

const TODAY = "2026-09-24";

describe("daysUntil", () => {
  it("counts whole UTC days regardless of the time of day on the target", () => {
    expect(daysUntil(TODAY, new Date("2026-09-25T00:00:00Z"))).toBe(1);
    expect(daysUntil(TODAY, new Date("2026-09-25T23:59:59Z"))).toBe(1);
    expect(daysUntil(TODAY, new Date("2026-10-01T12:00:00Z"))).toBe(7);
  });

  it("is zero today and negative in the past", () => {
    expect(daysUntil(TODAY, new Date("2026-09-24T17:00:00Z"))).toBe(0);
    expect(daysUntil(TODAY, new Date("2026-09-20T00:00:00Z"))).toBe(-4);
  });
});

describe("dueSoonHorizon", () => {
  it("fires only at the T-1, T-3 and T-7 horizons", () => {
    expect(DUE_SOON_HORIZONS).toEqual([1, 3, 7]);
    expect(dueSoonHorizon(TODAY, new Date("2026-09-25T00:00:00Z"))).toBe(1);
    expect(dueSoonHorizon(TODAY, new Date("2026-09-27T00:00:00Z"))).toBe(3);
    expect(dueSoonHorizon(TODAY, new Date("2026-10-01T00:00:00Z"))).toBe(7);
    expect(dueSoonHorizon(TODAY, new Date("2026-09-26T00:00:00Z"))).toBeNull();
    expect(dueSoonHorizon(TODAY, new Date("2026-09-24T00:00:00Z"))).toBeNull();
    expect(dueSoonHorizon(TODAY, new Date("2026-10-02T00:00:00Z"))).toBeNull();
  });

  it("ignores missing or invalid dates", () => {
    expect(dueSoonHorizon(TODAY, null)).toBeNull();
    expect(dueSoonHorizon(TODAY, undefined)).toBeNull();
    expect(dueSoonHorizon(TODAY, new Date("nope"))).toBeNull();
  });
});

describe("dueSoonSubject / dueSoonBody", () => {
  it("names the horizon, the opportunity and the date", () => {
    expect(dueSoonSubject(3, "Army logistics recompete", "2026-09-27")).toBe(
      "[T-3] Army logistics recompete — response due 2026-09-27",
    );
    expect(dueSoonBody(1, "Army logistics recompete", "2026-09-25")).toBe(
      'The response for "Army logistics recompete" is due tomorrow (2026-09-25).',
    );
    expect(dueSoonBody(7, "X", "2026-10-01")).toContain("in 7 days");
  });

  it("truncates very long titles in the subject", () => {
    const s = dueSoonSubject(1, "t".repeat(300), "2026-09-25");
    expect(s.length).toBeLessThan(140);
  });
});
