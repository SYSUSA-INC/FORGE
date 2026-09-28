/**
 * BL-AIP-5b — scoring a draft against the text that won.
 */

import { describe, expect, it } from "vitest";
import {
  meanScore,
  placeholderRate,
  scoreDraftAgainstGolden,
  specificityDensity,
  topTerms,
} from "@/lib/golden-score";

const GOLDEN =
  "Our transition team cut over the Navy help desk in 30 days with zero missed tickets. " +
  "The transition plan names a dedicated transition manager, weekly Navy checkpoints and a knowledge capture sprint. " +
  "Help desk staffing scales from 12 to 18 analysts during surge, measured against a 95% first-call resolution target.";

describe("topTerms", () => {
  it("returns the most frequent distinctive terms first", () => {
    const terms = topTerms(GOLDEN, 5);
    expect(terms[0]).toBe("transition");
    expect(terms).toContain("navy");
    expect(terms).not.toContain("the");
  });
});

describe("specificityDensity / placeholderRate", () => {
  it("counts numbers and names per hundred words, and bracket placeholders", () => {
    expect(specificityDensity("Two plain sentences here. Nothing specific at all.")).toBe(0);
    expect(specificityDensity("Navy awarded 3 task orders worth $4.2M in 2025.")).toBeGreaterThan(20);
    // Ten words; the [S1] citation marker and the [L.5.2] requirement
    // reference are not placeholders.
    expect(placeholderRate("We deliver [CUSTOMER NAME] outcomes with [S1] support in [L.5.2].")).toBe(10);
    expect(placeholderRate("")).toBe(0);
  });
});

describe("scoreDraftAgainstGolden", () => {
  it("scores the winning text against itself at the top and an unrelated draft low", () => {
    const same = scoreDraftAgainstGolden({ draft: GOLDEN, golden: GOLDEN });
    expect(same.termCoverage).toBe(1);
    expect(same.lengthFit).toBe(1);
    expect(same.specificity).toBe(1);
    expect(same.placeholderRate).toBe(0);
    expect(same.score).toBe(1);
    expect(same.themeCoverage).toBeNull();

    const unrelated = scoreDraftAgainstGolden({
      draft: "We are pleased to offer a robust world-class solution that leverages synergies.",
      golden: GOLDEN,
    });
    expect(unrelated.termCoverage).toBeLessThan(0.1);
    expect(unrelated.score).toBeLessThan(0.45);
    expect(unrelated.score).toBeGreaterThan(0);
  });

  it("penalises placeholders and rewards theme coverage", () => {
    const punted = scoreDraftAgainstGolden({
      draft: "Our transition team will cut over the help desk in [NUMBER] days with [METRIC] tickets. A dedicated transition manager runs [CUSTOMER] checkpoints weekly.",
      golden: GOLDEN,
      themes: [{ title: "Zero-risk transition", statement: "A dedicated transition manager and weekly checkpoints." }],
    });
    expect(punted.placeholderRate).toBeGreaterThan(10);
    expect(punted.themeCoverage).toBeGreaterThan(0.5);
    const clean = scoreDraftAgainstGolden({
      draft: "Our transition team will cut over the help desk in 30 days with zero missed tickets. Navy checkpoints weekly.",
      golden: GOLDEN,
    });
    expect(clean.score).toBeGreaterThan(punted.score);
  });

  it("averages runs and handles empty inputs", () => {
    expect(meanScore([])).toBe(0);
    expect(meanScore([{ score: 0.5 }, { score: 0.75 }])).toBe(0.625);
    const empty = scoreDraftAgainstGolden({ draft: "", golden: GOLDEN });
    expect(empty.lengthFit).toBe(0);
    expect(empty.termCoverage).toBe(0);
  });
});
