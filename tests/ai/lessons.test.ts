import { describe, expect, it } from "vitest";
import { acceptDraftedLessons, emptyAppliesTo, lessonsMatching, sanitizeLessonInput, termsFrom } from "@/lib/lessons";
import { buildLessonsExtractPrompt } from "@/lib/lessons-prompt";

const applies = (over: Partial<ReturnType<typeof emptyAppliesTo>> = {}) => ({ ...emptyAppliesTo(), ...over });

describe("acceptDraftedLessons", () => {
  it("keeps only shown evidence, drops repeats of existing lessons, cleans NAICS and pins unscoped lessons to the bid", () => {
    const out = acceptDraftedLessons({
      parsed: {
        lessons: [
          { text: "Price the transition at cost.", kind: "do", source: "debrief", appliesTo: applies({ naicsCodes: ["NAICS 541512"], sectionKinds: ["pricing", "bogus"] }), evidence: ["debrief:d1", "winner:nope", "debrief:d1"] },
          { text: "Show a 90-day cutover plan.", kind: "do", source: "winner_analysis", appliesTo: applies(), evidence: [] },
          { text: "price the transition at cost", kind: "avoid", source: "outcome", appliesTo: applies(), evidence: [] },
          { text: "Already known lesson.", kind: "watch", source: "review", appliesTo: applies(), evidence: [] },
        ],
      },
      allowedEvidence: new Set(["debrief:d1", "outcome:o1"]),
      existingTexts: ["Already known lesson!"],
      agency: "VA",
      naicsCode: "541512",
    });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ evidence: ["debrief:d1"], appliesTo: { naicsCodes: ["541512"], sectionKinds: ["pricing"], agencies: [], capabilities: [] } });
    expect(out[1]?.appliesTo).toEqual({ agencies: ["VA"], naicsCodes: ["541512"], sectionKinds: [], capabilities: [] });
  });
});

describe("lessonsMatching", () => {
  const ls = [
    { id: "a", appliesTo: applies({ agencies: ["VA"] }) },
    { id: "b", appliesTo: applies({ naicsCodes: ["541512"] }) },
    { id: "c", appliesTo: applies({ sectionKinds: ["pricing"] }) },
    { id: "d", appliesTo: applies({ capabilities: ["ITSM migration"] }) },
    { id: "e", appliesTo: applies() },
  ];
  it("matches on any field, case-insensitively, and an unscoped lesson matches everything", () => {
    expect(lessonsMatching(ls, { agency: "va" }).map((l) => l.id)).toEqual(["a", "e"]);
    expect(lessonsMatching(ls, { naicsCode: "541512" }).map((l) => l.id)).toEqual(["b", "e"]);
    expect(lessonsMatching(ls, { sectionKind: "pricing", capabilities: ["itsm migration"] }).map((l) => l.id)).toEqual(["c", "d", "e"]);
    expect(lessonsMatching(ls, {}).map((l) => l.id)).toEqual(["e"]);
  });
});

describe("sanitizeLessonInput and termsFrom", () => {
  it("rejects a too-short lesson, defaults the kind, and splits terms", () => {
    expect(sanitizeLessonInput({ text: "short", kind: "do" })).toBeNull();
    expect(sanitizeLessonInput({ text: "  Price the transition at cost.  ", kind: "nonsense", appliesTo: { agencies: ["VA", "VA", ""], naicsCodes: [], sectionKinds: ["pricing"], capabilities: [] } })).toEqual({
      text: "Price the transition at cost.",
      kind: "do",
      appliesTo: { agencies: ["VA"], naicsCodes: [], sectionKinds: ["pricing"], capabilities: [] },
    });
    expect(termsFrom(" VA, DHS ,, va", 5)).toEqual(["VA", "DHS", "va"]);
  });
});

describe("buildLessonsExtractPrompt", () => {
  it("shows every evidence id with its prefix and the lessons already recorded", () => {
    const p = buildLessonsExtractPrompt({
      proposal: { title: "VA ITSM", agency: "VA", naicsCode: "541512", outcome: "lost", reasons: ["price"], summary: "", lessonsLearned: "", awardedTo: "Rival" },
      outcomeId: "o1",
      debrief: { id: "d1", status: "held", strengths: "", weaknesses: "Price", improvements: "", notes: "" },
      winnerGaps: [{ id: "w1", text: "cutover plan" }],
      reviewComments: [{ id: "c1", section: "Pricing", text: "heavy" }],
      lossPatterns: [{ id: "p1", title: "Price", detail: "3 of 4" }],
      sectionKinds: ["pricing"],
      existing: ["Do not bid VA on price alone."],
    });
    const text = p.messages[0]!.content;
    for (const id of ["outcome:o1", "debrief:d1", "winner:w1", "comment:c1", "pattern:p1", "LOST", "awarded to Rival", "Do not bid VA on price alone."]) expect(text).toContain(id);
    expect(p.system).toContain("at most 8 lessons");
  });
});
