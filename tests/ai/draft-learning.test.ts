/**
 * BL-NAV-LIFECYCLE 5d-1 — the arithmetic of "AI first draft kept through
 * each review" and "reviewers' suggestions accepted" (pure logic).
 */
import { describe, expect, it } from "vitest";
import {
  keptShare,
  latestPerSection,
  measureRetention,
  retentionByReview,
  reviewerDecisionStats,
  roundByReviewer,
} from "@/lib/draft-learning-logic";

const DRAFT = "Our team delivers secure cloud migration services on schedule and within the agreed budget every time";

describe("measureRetention", () => {
  it("grades an untouched draft as fully kept and a rewritten one as gone", () => {
    const [same, gone] = measureRetention([
      { sectionId: "s1", draftText: DRAFT, currentText: DRAFT },
      { sectionId: "s2", draftText: DRAFT, currentText: "A completely different paragraph that shares nothing with what came before it at all" },
    ]);
    expect(same).toMatchObject({ sectionId: "s1", draftWordCount: 16, keptWordCount: 16, keptFraction: 1 });
    expect(gone).toMatchObject({ sectionId: "s2", keptWordCount: 0, keptFraction: 0 });
  });

  it("grades a half-kept draft between the two and never counts more kept than drafted", () => {
    const [half] = measureRetention([
      { sectionId: "s1", draftText: DRAFT, currentText: "Our team delivers secure cloud migration services with a new ending nobody wrote before" },
    ]);
    expect(half!.keptFraction).toBeGreaterThan(0);
    expect(half!.keptFraction).toBeLessThan(1);
    expect(half!.keptWordCount).toBeLessThanOrEqual(half!.draftWordCount);
  });

  it("leaves out a draft with no words", () => {
    expect(measureRetention([{ sectionId: "s1", draftText: "   ", currentText: "anything" }])).toEqual([]);
  });
});

describe("keptShare", () => {
  it("weights each section by the size of its draft", () => {
    // 100 words fully kept and 300 words not kept at all: a quarter, not a half.
    expect(keptShare([{ draftWordCount: 100, keptWordCount: 100 }, { draftWordCount: 300, keptWordCount: 0 }])).toBe(0.25);
  });

  it("is null with nothing measured and never passes 1", () => {
    expect(keptShare([])).toBeNull();
    expect(keptShare([{ draftWordCount: 0, keptWordCount: 0 }])).toBeNull();
    expect(keptShare([{ draftWordCount: 10, keptWordCount: 25 }])).toBe(1);
  });
});

describe("latestPerSection", () => {
  it("keeps the first (newest) row of each section", () => {
    const rows = [
      { sectionId: "a", v: 3 },
      { sectionId: "b", v: 2 },
      { sectionId: "a", v: 1 },
    ];
    expect(latestPerSection(rows)).toEqual([{ sectionId: "a", v: 3 }, { sectionId: "b", v: 2 }]);
  });
});

describe("retentionByReview", () => {
  it("gives one line per round, oldest first, with the weighted share", () => {
    const out = retentionByReview([
      { reviewId: "red", reviewColor: "red", startedAt: "2026-11-10T00:00:00.000Z", draftWordCount: 200, keptWordCount: 80 },
      { reviewId: "pink", reviewColor: "pink", startedAt: "2026-11-01T00:00:00.000Z", draftWordCount: 100, keptWordCount: 90 },
      { reviewId: "pink", reviewColor: "pink", startedAt: "2026-11-01T00:00:00.000Z", draftWordCount: 100, keptWordCount: 70 },
    ]);
    expect(out.map((r) => r.color)).toEqual(["pink", "red"]);
    expect(out[0]).toMatchObject({ reviewId: "pink", sections: 2, keptShare: 0.8 });
    expect(out[1]).toMatchObject({ reviewId: "red", sections: 1, keptShare: 0.4 });
  });

  it("returns nothing for no rows", () => {
    expect(retentionByReview([])).toEqual([]);
  });
});

describe("reviewerDecisionStats", () => {
  it("counts per colour in the colour order given and ignores other decisions", () => {
    const out = reviewerDecisionStats(
      [
        { reviewColor: "red", decision: "accept", n: 1 },
        { reviewColor: "red", decision: "reject", n: 3 },
        { reviewColor: "pink", decision: "accept", n: 4 },
        { reviewColor: "pink", decision: "withdrawn", n: 9 },
      ],
      ["pink", "red", "gold"],
    );
    expect(out).toEqual([
      { color: "pink", decided: 4, acceptRate: 1 },
      { color: "red", decided: 4, acceptRate: 0.25 },
    ]);
  });
});

describe("roundByReviewer", () => {
  it("takes each reviewer's newest round", () => {
    const map = roundByReviewer([
      { userId: "u1", reviewId: "red", color: "red" },
      { userId: "u1", reviewId: "pink", color: "pink" },
      { userId: "u2", reviewId: "pink", color: "pink" },
    ]);
    expect(map.get("u1")).toEqual({ reviewId: "red", color: "red" });
    expect(map.get("u2")).toEqual({ reviewId: "pink", color: "pink" });
    expect(map.has("u3")).toBe(false);
  });
});
