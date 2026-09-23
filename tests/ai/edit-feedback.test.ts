/**
 * BL-9 Slice 7 — the pure summariser behind the track-changes feedback
 * the section drafter reads.
 */

import { describe, expect, it } from "vitest";
import {
  EDIT_FEEDBACK_MIN_SAMPLE,
  countWords,
  summarizeEditDecisions,
  type EditDecisionInput,
} from "@/lib/edit-feedback-summary";

function row(
  changeType: EditDecisionInput["changeType"],
  decision: EditDecisionInput["decision"],
  text: string,
  daysAgo = 0,
): EditDecisionInput {
  return {
    changeType,
    decision,
    text,
    createdAt: new Date(Date.UTC(2026, 8, 23) - daysAgo * 86_400_000),
  };
}

describe("edit-feedback summary", () => {
  it("returns null below the minimum sample", () => {
    const rows = Array.from({ length: EDIT_FEEDBACK_MIN_SAMPLE - 1 }, () =>
      row("insert", "accept", "we deliver measurable outcomes on schedule"),
    );
    expect(summarizeEditDecisions(rows)).toBeNull();
    expect(summarizeEditDecisions([...rows, row("delete", "reject", "x")])).not.toBeNull();
  });

  it("computes acceptance rates per change type and nulls a type with no rows", () => {
    const s = summarizeEditDecisions([
      row("insert", "accept", "our team has supported this mission since 2019"),
      row("insert", "accept", "the transition plan retains all incumbent staff"),
      row("insert", "reject", "we are pleased to offer a world-class solution"),
      row("insert", "reject", "our robust best-in-class platform"),
      row("insert", "accept", "each deliverable maps to a Section L requirement"),
    ]);
    expect(s).not.toBeNull();
    expect(s!.sampleSize).toBe(5);
    expect(s!.insertAcceptRate).toBeCloseTo(3 / 5);
    expect(s!.deleteAcceptRate).toBeNull();
  });

  it("buckets phrases by (type, decision), newest first, skipping short fragments and duplicates", () => {
    const s = summarizeEditDecisions([
      row("insert", "accept", "typo", 0), // < 4 words → skipped
      row("insert", "accept", "each deliverable maps to a Section L requirement", 3),
      row("insert", "accept", "the transition plan retains all incumbent staff", 1),
      row("insert", "accept", "The transition plan retains all incumbent staff.", 0), // case dup (with punctuation it differs) — kept
      row("insert", "accept", "the transition plan retains all incumbent staff", 2), // exact dup → skipped
      row("insert", "reject", "we are pleased to offer a world-class solution", 0),
      row("delete", "accept", "as previously mentioned above in this section", 0),
      row("delete", "reject", "our staff hold active clearances", 0),
    ]);
    expect(s).not.toBeNull();
    expect(s!.preferredPhrases).toEqual([
      "The transition plan retains all incumbent staff.",
      "the transition plan retains all incumbent staff",
      "each deliverable maps to a Section L requirement",
    ]);
    expect(s!.rejectedPhrases).toEqual(["we are pleased to offer a world-class solution"]);
    expect(s!.removedPhrases).toEqual(["as previously mentioned above in this section"]);
    // A rejected deletion is text the owner kept; it belongs in no list.
    expect([...s!.preferredPhrases, ...s!.rejectedPhrases, ...s!.removedPhrases]).not.toContain(
      "our staff hold active clearances",
    );
  });

  it("caps each list and truncates long phrases with an ellipsis", () => {
    const rows: EditDecisionInput[] = Array.from({ length: 10 }, (_, i) =>
      row("insert", "accept", `accepted phrase number ${i} with enough words in it`, i),
    );
    const long = "word ".repeat(60).trim();
    rows.push(row("insert", "reject", long, 0));
    const s = summarizeEditDecisions(rows, { maxPhrases: 3, maxChars: 40 });
    expect(s!.preferredPhrases).toHaveLength(3);
    expect(s!.preferredPhrases[0]).toContain("number 0");
    expect(s!.rejectedPhrases[0]!.length).toBeLessThanOrEqual(40);
    expect(s!.rejectedPhrases[0]!.endsWith("…")).toBe(true);
    expect(s!.windowDays).toBe(180);
  });

  it("countWords ignores surrounding and repeated whitespace", () => {
    expect(countWords("  two   words ")).toBe(2);
    expect(countWords("")).toBe(0);
  });
});
