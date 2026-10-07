/**
 * BL-AIX Phase 1h-2 — the judge's rubric scores and how its agreement
 * with the organization's experts is measured.
 */
import { describe, expect, it } from "vitest";
import { agreement, CALIBRATION_MIN_PAIRS, cleanScores, judgePairs, spearman } from "@/lib/draft-judge-logic";

describe("BL-AIX Phase 1h-2 — draft judge logic", () => {
  it("keeps scores whole and between 1 and 5, and refuses a missing one", () => {
    expect(cleanScores({ compliance: 4.6, evaluation: 0, specificity: 9, clarity: "3", overall: 3 })).toEqual({
      compliance: 5,
      evaluation: 1,
      specificity: 5,
      clarity: 3,
      overall: 3,
    });
    expect(cleanScores({ compliance: 4, evaluation: 4, specificity: 4, clarity: 4 })).toBeNull();
    expect(cleanScores({ compliance: 4, evaluation: "x", specificity: 4, clarity: 4, overall: 4 })).toBeNull();
  });

  it("ranks with ties and gives up on constant or tiny samples", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
    expect(spearman([1, 2, 2, 3], [1, 2, 3, 4])).toBeCloseTo(0.9487, 3);
    expect(spearman([3, 3, 3], [1, 2, 3])).toBeNull();
    expect(spearman([1, 2], [1, 2])).toBeNull();
  });

  it("calls the judge calibrated only with enough close, well-ranked pairs", () => {
    expect(agreement([]).verdict).toBe("collecting");
    const close = Array.from({ length: CALIBRATION_MIN_PAIRS }, (_, i) => ({ judge: (i % 5) + 1, expert: Math.min(5, (i % 5) + 1 + (i % 2)) }));
    const a = agreement(close);
    expect(a).toMatchObject({ n: 10, withinOne: 1, verdict: "calibrated" });
    expect(agreement(close.slice(0, 9)).verdict).toBe("collecting");

    const far = Array.from({ length: CALIBRATION_MIN_PAIRS }, (_, i) => ({ judge: 5, expert: (i % 2) + 1 }));
    expect(agreement(far)).toMatchObject({ withinOne: 0, verdict: "disagrees" });
    expect(agreement([{ judge: 4, expert: 2 }])).toMatchObject({ n: 1, meanAbsDiff: 2, withinOne: 0, spearman: null });
  });

  it("pairs every expert rating with the judge's score for the same draft, skipping unjudged drafts", () => {
    const pairs = judgePairs(
      [
        { runId: "r1", sectionId: "s1", judgeOverall: 4 },
        { runId: "r1", sectionId: "s2", judgeOverall: null },
      ],
      [
        { runId: "r1", sectionId: "s1", overall: 3 },
        { runId: "r1", sectionId: "s1", overall: 5 },
        { runId: "r1", sectionId: "s2", overall: 2 },
        { runId: "r2", sectionId: "s1", overall: 2 },
      ],
    );
    expect(pairs).toEqual([
      { judge: 4, expert: 3 },
      { judge: 4, expert: 5 },
    ]);
  });
});
