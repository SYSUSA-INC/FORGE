/**
 * BL-AIP-6b — review comments in the editor, pure parts.
 */
import { describe, expect, it } from "vitest";
import {
  AI_REVIEW_PREFIX,
  describeOpenComments,
  groupBySection,
  parseReviewBody,
  REVIEW_COLOR_LABELS,
} from "@/lib/review-comments";

describe("parseReviewBody", () => {
  it("splits an AI pre-review body into severity and text", () => {
    expect(parseReviewBody(`${AI_REVIEW_PREFIX} · high] The section never names the incumbent.`)).toEqual({
      ai: true,
      severity: "high",
      text: "The section never names the incumbent.",
    });
    expect(parseReviewBody(`${AI_REVIEW_PREFIX} · Medium]  Cite the PWS paragraph.`)).toEqual({
      ai: true,
      severity: "medium",
      text: "Cite the PWS paragraph.",
    });
    expect(parseReviewBody(`${AI_REVIEW_PREFIX}] Verdict: conditional.`)).toEqual({
      ai: true,
      severity: null,
      text: "Verdict: conditional.",
    });
  });

  it("passes a human body through, trimmed", () => {
    expect(parseReviewBody("  Please cite the PWS paragraph. ")).toEqual({
      ai: false,
      severity: null,
      text: "Please cite the PWS paragraph.",
    });
    expect(parseReviewBody("[Not the AI] something").ai).toBe(false);
  });
});

describe("grouping and labels", () => {
  it("groups by section, dropping comments without one", () => {
    const g = groupBySection([
      { id: "1", sectionId: "a" },
      { id: "2", sectionId: null },
      { id: "3", sectionId: "a" },
      { id: "4", sectionId: "b" },
    ]);
    expect(Object.keys(g)).toEqual(["a", "b"]);
    expect(g.a!.map((c) => c.id)).toEqual(["1", "3"]);
    expect(g.b!.map((c) => c.id)).toEqual(["4"]);
  });

  it("describes the open count with the AI share", () => {
    expect(describeOpenComments([])).toBe("");
    expect(describeOpenComments([{ authorName: "Ann" }])).toBe("1 open review comment");
    expect(describeOpenComments([{ authorName: null }, { authorName: "Ann" }])).toBe(
      "2 open review comments · 1 from FORGE AI",
    );
    expect(REVIEW_COLOR_LABELS.white_gloves).toBe("White Gloves");
  });
});
