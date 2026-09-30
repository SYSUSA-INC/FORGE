/**
 * BL-AIP-7b part ii — "PWin movers", pure parts.
 */

import { describe, expect, it } from "vitest";
import { computeMovers, explainMove, snapshotChanged, type MoverSnapshot } from "@/lib/pwin-movers";

const now = new Date("2026-09-30T09:30:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60_000);

const evalLow = { key: "evaluation", label: "Evaluation", logOdds: -0.4, detail: "rollup 2/5" };
const evalHigh = { key: "evaluation", label: "Evaluation", logOdds: 0.6, detail: "rollup 4/5" };
const incumbent = { key: "incumbent", label: "Incumbency", logOdds: 0.9, detail: "you are the incumbent" };
const readiness = { key: "readiness", label: "Readiness", logOdds: 0.05, detail: "scan strong" };

function snap(opportunityId: string, pwin: number, d: number, factors = [] as MoverSnapshot["factors"]): MoverSnapshot {
  return { opportunityId, pwin, confidence: "medium", factors, createdAt: daysAgo(d) };
}

describe("snapshotChanged", () => {
  it("is true for the first snapshot, a moved PWin, a confidence change or a factor change", () => {
    const base = { pwin: 40, confidence: "medium", factors: [evalLow] };
    expect(snapshotChanged(null, base)).toBe(true);
    expect(snapshotChanged(base, { ...base })).toBe(false);
    expect(snapshotChanged(base, { ...base, pwin: 41 })).toBe(true);
    expect(snapshotChanged(base, { ...base, confidence: "high" })).toBe(true);
    expect(snapshotChanged(base, { ...base, factors: [evalHigh] })).toBe(true);
    // Factor order does not matter; tiny log-odds noise does not either.
    expect(snapshotChanged({ ...base, factors: [evalLow, incumbent] }, { ...base, factors: [incumbent, evalLow] })).toBe(false);
    expect(snapshotChanged(base, { ...base, factors: [{ ...evalLow, logOdds: -0.401 }] })).toBe(false);
  });
});

describe("explainMove", () => {
  it("names the largest factor changes with a direction, including a factor that disappeared", () => {
    expect(explainMove([evalLow, incumbent, readiness], [evalHigh, readiness])).toEqual([
      "▲ Evaluation: rollup 4/5",
      "▼ Incumbency: no longer applies (was: you are the incumbent)",
    ]);
    expect(explainMove([readiness], [{ ...readiness, logOdds: 0.1 }])).toEqual([]);
    expect(explainMove([], [evalHigh], 0.15, 1)).toEqual(["▲ Evaluation: rollup 4/5"]);
  });
});

describe("computeMovers", () => {
  it("reports the latest against the oldest snapshot inside the window, largest move first", () => {
    const rows = [
      snap("a", 30, 6, [evalLow]),
      snap("a", 38, 3, [evalLow]),
      snap("a", 52, 0, [evalHigh]),
      snap("b", 60, 5),
      snap("b", 48, 1),
      // One snapshot only: not a move.
      snap("c", 70, 2),
      // Small move: below the threshold.
      snap("d", 40, 4),
      snap("d", 43, 0),
      // Outside the window: ignored, so "e" has a single snapshot inside it.
      snap("e", 10, 12),
      snap("e", 80, 1),
    ];
    const movers = computeMovers(rows, { now, windowDays: 7 });
    expect(movers.map((m) => m.opportunityId)).toEqual(["a", "b"]);
    expect(movers[0]).toMatchObject({
      from: 30,
      to: 52,
      delta: 22,
      days: 6,
      confidence: "medium",
      reasons: ["▲ Evaluation: rollup 4/5"],
    });
    expect(movers[1]).toMatchObject({ from: 60, to: 48, delta: -12, days: 4, reasons: [] });
  });

  it("honours minDelta and limit", () => {
    const rows = [snap("a", 30, 2), snap("a", 33, 0), snap("b", 30, 2), snap("b", 50, 0)];
    expect(computeMovers(rows, { now, minDelta: 3 }).map((m) => m.opportunityId)).toEqual(["b", "a"]);
    expect(computeMovers(rows, { now, minDelta: 3, limit: 1 }).map((m) => m.opportunityId)).toEqual(["b"]);
    expect(computeMovers([], { now })).toEqual([]);
  });
});
