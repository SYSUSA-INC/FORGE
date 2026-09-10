/**
 * BL-FB-WIN-CROSS-LOSS — tests for the pure pattern detector.
 *
 * Pins each pattern's trigger and threshold, the competitor record, the
 * money parser, and that clean data produces no patterns.
 */

import { describe, expect, it } from "vitest";
import {
  detectLossPatterns,
  LOSS_THRESHOLDS,
  normalizeName,
  parseMoney,
  reasonLabel,
  type DecidedPursuit,
} from "@/lib/loss-patterns";

const NOW = new Date("2026-09-10T00:00:00Z");

let seq = 0;
function pursuit(over: Partial<DecidedPursuit>): DecidedPursuit {
  seq += 1;
  return {
    proposalId: `p${seq}`,
    title: `Pursuit ${seq}`,
    outcome: "lost",
    decidedAt: "2026-06-01T00:00:00Z",
    agency: "",
    naicsCode: "",
    setAside: "",
    setAsideEligible: null,
    reasons: [],
    awardedTo: "",
    competitors: [],
    awardValue: null,
    estimateMid: null,
    hasDebriefNotes: true,
    ...over,
  };
}

describe("loss patterns — helpers", () => {
  it("parseMoney reads common formats and rejects junk", () => {
    expect(parseMoney("$1.2M")).toBe(1_200_000);
    expect(parseMoney("850k")).toBe(850_000);
    expect(parseMoney("1,200,000")).toBe(1_200_000);
    expect(parseMoney("1.5 million")).toBe(1_500_000);
    expect(parseMoney("$2B")).toBe(2_000_000_000);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("TBD")).toBeNull();
    expect(parseMoney("0")).toBeNull();
    expect(parseMoney(null)).toBeNull();
  });

  it("normalizeName folds case, punctuation and corporate suffixes", () => {
    expect(normalizeName("Booz Allen Hamilton, Inc.")).toBe("booz allen hamilton");
    expect(normalizeName("  BOOZ ALLEN HAMILTON ")).toBe("booz allen hamilton");
    expect(normalizeName("Acme LLC")).toBe("acme");
  });
});

describe("loss patterns — detection", () => {
  it("returns totals and no patterns for a clean record", () => {
    const intel = detectLossPatterns(
      [
        pursuit({ outcome: "won", agency: "FAA" }),
        pursuit({ outcome: "won", agency: "FAA" }),
        pursuit({ outcome: "lost", agency: "DHS", reasons: ["price"], awardedTo: "Acme" }),
      ],
      { now: NOW },
    );
    expect(intel.decided).toBe(3);
    expect(intel.won).toBe(2);
    expect(intel.lost).toBe(1);
    expect(intel.winRate).toBeCloseTo(2 / 3, 5);
    expect(intel.patterns).toEqual([]);
    expect(intel.reasonTotals).toEqual([{ reason: "price", label: expect.any(String), count: 1 }]);
    expect(intel.competitors[0]).toMatchObject({ name: "Acme", faced: 1, lostTo: 1, wonAgainst: 0 });
  });

  it("flags a competitor you keep losing to, with faced count from tracked competitors", () => {
    const intel = detectLossPatterns(
      [
        pursuit({ outcome: "lost", agency: "Army", awardedTo: "Booz Allen Hamilton", reasons: ["price"] }),
        pursuit({ outcome: "lost", agency: "Navy", awardedTo: "Booz Allen Hamilton, Inc.", reasons: ["price", "technical"] }),
        pursuit({ outcome: "lost", agency: "Army", awardedTo: "BOOZ ALLEN HAMILTON", reasons: ["price"] }),
        pursuit({ outcome: "won", agency: "Army", competitors: ["Booz Allen Hamilton"] }),
        pursuit({ outcome: "won", agency: "DHS", competitors: ["Booz Allen Hamilton"] }),
      ],
      { now: NOW },
    );
    const comp = intel.patterns.find((p) => p.kind === "competitor");
    expect(comp).toBeDefined();
    expect(comp!.severity).toBe("high");
    expect(comp!.title).toBe("Lost 3 of 5 against Booz Allen Hamilton");
    expect(comp!.detail).toContain("Leading reason");
    expect(comp!.evidence).toHaveLength(3);
    const rec = intel.competitors.find((c) => normalizeName(c.name) === "booz allen hamilton");
    expect(rec).toMatchObject({ faced: 5, lostTo: 3, wonAgainst: 2, leadingReason: "price" });
    expect(rec!.agencies.sort()).toEqual(["Army", "Navy"]);
  });

  it("does not flag a competitor below the loss threshold", () => {
    const intel = detectLossPatterns(
      [pursuit({ outcome: "lost", awardedTo: "Acme" }), pursuit({ outcome: "lost", awardedTo: "Other" })],
      { now: NOW },
    );
    expect(intel.patterns.filter((p) => p.kind === "competitor")).toEqual([]);
  });

  it("flags a segment whose losses share a reason, 'Every' when unanimous", () => {
    const intel = detectLossPatterns(
      [
        pursuit({ naicsCode: "541330", reasons: ["past_performance"] }),
        pursuit({ naicsCode: "541330", reasons: ["past_performance", "price"] }),
        pursuit({ naicsCode: "541330", reasons: ["past_performance"] }),
        pursuit({ naicsCode: "541512", reasons: ["technical"] }),
      ],
      { now: NOW },
    );
    const seg = intel.patterns.find((p) => p.kind === "segment_reason");
    expect(seg).toBeDefined();
    expect(seg!.severity).toBe("high");
    expect(seg!.title).toMatch(/^Every NAICS 541330 loss cites /);
    expect(seg!.evidence).toHaveLength(3);
    // Partial share above 50% but below 75% is medium.
    const partial = detectLossPatterns(
      [
        pursuit({ agency: "DHS", reasons: ["price"] }),
        pursuit({ agency: "DHS", reasons: ["price"] }),
        pursuit({ agency: "DHS", reasons: ["technical"] }),
        pursuit({ agency: "DHS", reasons: ["schedule"] }),
      ],
      { now: NOW },
    );
    const p = partial.patterns.find((x) => x.kind === "segment_reason");
    expect(p?.severity).toBe("medium");
    expect(p?.title).toBe(`2 of 4 DHS losses cite ${reasonLabel("price")}`);
  });

  it("flags price losses whose estimate runs above the award, with honest wording", () => {
    const intel = detectLossPatterns(
      [
        pursuit({ reasons: ["price"], awardValue: 1_000_000, estimateMid: 1_200_000 }),
        pursuit({ reasons: ["price"], awardValue: 2_000_000, estimateMid: 2_300_000 }),
        pursuit({ reasons: ["technical"], awardValue: 900_000, estimateMid: 1_500_000 }),
      ],
      { now: NOW },
    );
    const price = intel.patterns.find((p) => p.kind === "price");
    expect(price).toBeDefined();
    expect(price!.title).toMatch(/~1[78]% above the winning award/);
    expect(price!.severity).toBe("high");
    expect(price!.detail).toContain("Estimates, not bid prices");
    expect(price!.evidence).toHaveLength(2);
  });

  it("flags repeated bids on ineligible set-asides", () => {
    const intel = detectLossPatterns(
      [
        pursuit({ setAside: "8(a)", setAsideEligible: false }),
        pursuit({ setAside: "SDVOSB", setAsideEligible: false }),
        pursuit({ setAside: "Small Business", setAsideEligible: true }),
      ],
      { now: NOW },
    );
    const e = intel.patterns.find((p) => p.kind === "eligibility");
    expect(e).toBeDefined();
    expect(e!.title).toBe("2 losses were bids on set-asides the org profile doesn't qualify for");
  });

  it("flags a win-rate drop between the last two twelve-month windows", () => {
    const prior = ["2025-01-15", "2025-03-15", "2025-05-15", "2025-07-15"].map((d, i) =>
      pursuit({ outcome: i < 3 ? "won" : "lost", decidedAt: `${d}T00:00:00Z` }),
    );
    const recent = ["2026-01-15", "2026-03-15", "2026-05-15", "2026-07-15"].map((d, i) =>
      pursuit({ outcome: i < 1 ? "won" : "lost", decidedAt: `${d}T00:00:00Z` }),
    );
    const intel = detectLossPatterns([...prior, ...recent], { now: NOW });
    const t = intel.patterns.find((p) => p.kind === "trend");
    expect(t).toBeDefined();
    expect(t!.title).toBe("Win rate fell from 75% to 25%");
  });

  it("flags missing debriefs as a data gap and orders patterns by severity", () => {
    const intel = detectLossPatterns(
      [
        pursuit({ hasDebriefNotes: false, awardedTo: "Acme", reasons: ["price"] }),
        pursuit({ hasDebriefNotes: false, awardedTo: "Acme", reasons: ["price"] }),
        pursuit({ hasDebriefNotes: false, awardedTo: "Acme", reasons: ["price"] }),
        pursuit({ hasDebriefNotes: true }),
      ],
      { now: NOW },
    );
    const kinds = intel.patterns.map((p) => `${p.severity}:${p.kind}`);
    expect(kinds[0]).toBe("high:competitor");
    expect(kinds).toContain("info:debrief_gap");
    expect(intel.patterns[intel.patterns.length - 1]!.kind).toBe("debrief_gap");
    expect(intel.lossesWithDebrief).toBe(1);
    expect(LOSS_THRESHOLDS.debriefGapShare).toBe(0.5);
  });
});
