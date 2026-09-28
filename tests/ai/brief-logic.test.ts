/**
 * BL-AIP-7a — briefs, pure parts.
 */

import { describe, expect, it } from "vitest";
import {
  BRIEF_MAX_AGE_MS,
  briefIsFresh,
  clampConfidence,
  cleanList,
  gradeRecommendation,
  isRecommendation,
  snapshotKeyOf,
  summarizeBriefTrack,
} from "@/lib/brief-logic";

describe("gradeRecommendation", () => {
  it("scores pursue and no-bid against the outcome; watch is a hedge", () => {
    expect(gradeRecommendation("pursue", "won")).toBe("correct");
    expect(gradeRecommendation("pursue", "lost")).toBe("wrong");
    expect(gradeRecommendation("pursue", "no_bid")).toBe("wrong");
    expect(gradeRecommendation("no_bid", "lost")).toBe("correct");
    expect(gradeRecommendation("no_bid", "no_bid")).toBe("correct");
    expect(gradeRecommendation("no_bid", "won")).toBe("wrong");
    expect(gradeRecommendation("watch", "won")).toBe("inconclusive");
    expect(gradeRecommendation(null, "lost")).toBe("inconclusive");
  });
});

describe("briefIsFresh / snapshotKeyOf", () => {
  const now = new Date("2026-09-28T12:00:00Z");

  it("reuses a recent brief only when the snapshot key is unchanged", () => {
    const key = snapshotKeyOf({ stage: "capture", pwin: 40, due: 12 });
    expect(key).toBe('due=12&pwin=40&stage="capture"');
    expect(snapshotKeyOf({ pwin: 40, stage: "capture", due: 12 })).toBe(key);
    expect(briefIsFresh({ snapshotKey: key, createdAt: new Date(now.getTime() - 60_000) }, key, now)).toBe(true);
    expect(
      briefIsFresh({ snapshotKey: key, createdAt: new Date(now.getTime() - BRIEF_MAX_AGE_MS) }, key, now),
    ).toBe(false);
    expect(
      briefIsFresh({ snapshotKey: key, createdAt: now.toISOString() }, snapshotKeyOf({ stage: "writing" }), now),
    ).toBe(false);
  });
});

describe("summarizeBriefTrack", () => {
  it("counts grades and reports accuracy over decisive calls", () => {
    expect(summarizeBriefTrack([])).toEqual({ n: 0, correct: 0, wrong: 0, inconclusive: 0, accuracy: null });
    expect(
      summarizeBriefTrack([{ grade: "correct" }, { grade: "correct" }, { grade: "wrong" }, { grade: "inconclusive" }, { grade: null }]),
    ).toEqual({ n: 4, correct: 2, wrong: 1, inconclusive: 1, accuracy: 0.667 });
  });
});

describe("cleanList / clampConfidence / isRecommendation", () => {
  it("bounds and cleans model output", () => {
    expect(cleanList(["  a  b ", "", 3, "c"], 2)).toEqual(["a b", "c"]);
    expect(cleanList("nope", 3)).toEqual([]);
    expect(clampConfidence(1.4)).toBe(1);
    expect(clampConfidence(0.456)).toBe(0.46);
    expect(clampConfidence("0.5")).toBeNull();
    expect(isRecommendation("watch")).toBe(true);
    expect(isRecommendation("maybe")).toBe(false);
  });
});
