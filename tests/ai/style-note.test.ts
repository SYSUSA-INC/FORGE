/**
 * BL-NAV-LIFECYCLE 5d-2 — the style note builder (pure logic): what was
 * cut, what was added, the wording preferred, and what it leaves out.
 */
import { describe, expect, it } from "vitest";
import {
  buildStyleNote,
  droppedSentences,
  hasStyleContent,
  parseStyleNoteBody,
  recurringWording,
  type StyleDecision,
} from "@/lib/style-note-logic";

let clock = 0;
function decision(over: Partial<StyleDecision> & Pick<StyleDecision, "changeType" | "decision" | "text">): StyleDecision {
  clock += 1;
  return { createdAt: new Date(Date.UTC(2026, 10, 1, 0, clock)), ...over };
}

describe("recurringWording", () => {
  it("keeps terms that recur on one side and never appear on the other", () => {
    const kept = ["a single accountable lead for delivery", "our single accountable lead owns the schedule", "measured outcomes each quarter"];
    const cut = ["world-class synergy across the enterprise", "a world-class team", "the schedule slipped"];
    const preferred = recurringWording(kept, cut);
    expect(preferred).toContain("single accountable");
    expect(preferred).toContain("accountable lead");
    // "schedule" was also cut, and "outcomes" appears once: neither is a preference.
    expect(preferred).not.toContain("schedule");
    expect(preferred).not.toContain("outcomes");
    // A word already inside a chosen pair is not listed again.
    expect(preferred).not.toContain("accountable");
    expect(recurringWording(cut, kept)).toEqual(["world-class"]);
  });

  it("ignores short and common words", () => {
    expect(recurringWording(["we will do it for them", "we will do it for you"], [])).toEqual([]);
  });
});

describe("droppedSentences", () => {
  const draft =
    "Our team brings world-class synergy to every engagement we undertake. We migrated forty applications for the agency in nine months. Short one.";

  it("lists the AI's sentences with nothing left in the text", () => {
    const now = "We migrated forty applications for the agency in nine months, ahead of plan.";
    expect(droppedSentences(draft, now)).toEqual(["Our team brings world-class synergy to every engagement we undertake."]);
  });

  it("lists nothing when the draft is intact", () => {
    expect(droppedSentences(draft, draft)).toEqual([]);
  });
});

describe("buildStyleNote", () => {
  it("is null below five decisions", () => {
    const four = Array.from({ length: 4 }, () => decision({ changeType: "insert", decision: "accept", text: "a single accountable lead for delivery" }));
    expect(buildStyleNote({ decisions: four, drafts: [], windowDays: 180 })).toBeNull();
  });

  it("separates what was added, what was cut and the wording on each side", () => {
    const decisions: StyleDecision[] = [
      decision({ changeType: "insert", decision: "accept", text: "a single accountable lead for delivery" }),
      decision({ changeType: "insert", decision: "accept", text: "our single accountable lead owns the outcome", fromReviewer: true }),
      decision({ changeType: "delete", decision: "accept", text: "world-class synergy across the whole enterprise" }),
      decision({ changeType: "insert", decision: "reject", text: "a world-class team of seasoned experts", fromAi: true }),
      // FORGE AI's accepted text and accept-all are never the team's wording.
      decision({ changeType: "insert", decision: "accept", text: "leveraging robust holistic paradigms going forward", fromAi: true }),
      decision({ changeType: "insert", decision: "accept", text: "bulk accepted filler text nobody read closely", bulk: true }),
      // A typo fix is not phrasing.
      decision({ changeType: "insert", decision: "accept", text: "teh" }),
    ];
    const note = buildStyleNote({
      decisions,
      drafts: [
        { sectionId: "s1", draftText: "We deliver best-in-class value to every stakeholder we serve.", currentText: "A person wrote something else entirely here instead." },
      ],
      windowDays: 180,
    })!;

    expect(note.sampleSize).toBe(7);
    expect(note.reviewerDecisions).toBe(1);
    // The reviewer's kept addition leads.
    expect(note.added).toEqual(["our single accountable lead owns the outcome", "a single accountable lead for delivery"]);
    expect(note.cut).toEqual(["world-class synergy across the whole enterprise"]);
    expect(note.preferredWording).toEqual(expect.arrayContaining(["single accountable", "accountable lead"]));
    expect(note.avoidedWording).toEqual(["world-class"]);
    expect(note.droppedFromAiDrafts).toEqual(["We deliver best-in-class value to every stakeholder we serve."]);
    expect(note.aiDraftKeptShare).toBe(0);
    expect(note.aiDraftSections).toBe(1);
    const everything = JSON.stringify(note);
    expect(everything).not.toContain("holistic");
    expect(everything).not.toContain("filler");
    expect(hasStyleContent(note)).toBe(true);
  });

  it("caps each list and clips long passages", () => {
    const long = `${"a very long kept passage about delivery ".repeat(10)}end`;
    const decisions = Array.from({ length: 12 }, (_, i) => decision({ changeType: "insert", decision: "accept", text: `${long} ${i}` }));
    const note = buildStyleNote({ decisions, drafts: [], windowDays: 180 })!;
    expect(note.added).toHaveLength(6);
    expect(note.added.every((p) => p.length <= 160)).toBe(true);
    expect(note.aiDraftKeptShare).toBeNull();
  });
});

describe("parseStyleNoteBody", () => {
  it("round-trips a built note and refuses anything else", () => {
    const decisions = Array.from({ length: 5 }, () => decision({ changeType: "delete", decision: "accept", text: "world-class synergy across the whole enterprise" }));
    const note = buildStyleNote({ decisions, drafts: [], windowDays: 180 })!;
    expect(parseStyleNoteBody(JSON.parse(JSON.stringify(note)))).toEqual(note);
    expect(parseStyleNoteBody({})).toBeNull();
    expect(parseStyleNoteBody(null)).toBeNull();
    expect(parseStyleNoteBody({ sampleSize: 2, cut: ["x"] })).toBeNull();
    expect(parseStyleNoteBody({ sampleSize: 9, cut: ["ok", 4], added: "no" })).toMatchObject({ cut: ["ok"], added: [] });
  });
});
