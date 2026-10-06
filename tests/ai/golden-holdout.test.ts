/**
 * BL-AIX Phase 1c — the content layer of the golden-eval holdout: what
 * counts as a copy of the winning text, what the screen drops from
 * pattern intel, and how the leak gauge reads.
 */
import { describe, expect, it } from "vitest";
import type { SectionDraftPatternIntel } from "@/lib/ai-prompts";
import { copiesGolden, goldenOf, promptLeak, screenPatternIntel, shingles } from "@/lib/golden-holdout";

const WINNER =
  "Our three-wave migration moves forty applications to the FedRAMP High enclave without downtime. " +
  "Each wave ends with a rollback rehearsal signed off by the agency's change board before cutover. " +
  "We staff a 24x7 operations cell from day one so every incident has a named owner within fifteen minutes.";
const golden = goldenOf(WINNER);

describe("BL-AIX Phase 1c — golden holdout", () => {
  it("cuts text into 8-word runs, ignoring case and punctuation", () => {
    expect(shingles("One two three four five six seven eight nine").size).toBe(2);
    expect(shingles("Too short to have a run")).toEqual(new Set());
    expect(shingles("A b c d e f g h")).toEqual(shingles("a, B. c d E f g H!"));
  });

  it("treats a quoted or lightly edited passage as a copy and a paraphrase on the same topic as not", () => {
    expect(copiesGolden("Each wave ends with a rollback rehearsal signed off by the agency's change board.", golden)).toBe(true);
    expect(
      copiesGolden("Prior work: each wave ends with a rollback rehearsal signed off by the agency's change board before go-live.", golden),
    ).toBe(true);
    expect(copiesGolden("We migrate applications in waves and rehearse rollback with the customer before each cutover.", golden)).toBe(false);
  });

  it("drops a short phrase only when the winner contains it verbatim and it is at least four words", () => {
    expect(copiesGolden("named owner within fifteen minutes", golden)).toBe(true);
    expect(copiesGolden("owner within fifteen", golden)).toBe(false);
    expect(copiesGolden("named lead within ten minutes", golden)).toBe(false);
  });

  it("screens every snippet list in pattern intel and counts what it dropped", () => {
    const intel: SectionDraftPatternIntel = {
      winningPatterns: [
        { excerpt: WINNER, provenance: "won_proposal · Our own winner, re-uploaded" },
        { excerpt: "A phased approach with a rollback plan per phase and a single accountable lead.", provenance: "won_proposal · Other" },
      ],
      lostPatterns: [{ excerpt: "We are a world-class provider of robust solutions." }],
      complianceGaps: [],
      sectionSignal: null,
      editFeedback: {
        sampleSize: 10,
        windowDays: 180,
        insertAcceptRate: 0.5,
        deleteAcceptRate: 0.5,
        preferredPhrases: ["named owner within fifteen minutes", "single accountable lead"],
        rejectedPhrases: [],
        removedPhrases: [],
        aiSuggestionAcceptRate: null,
        aiDecisions: 0,
      },
      writingSignals: {
        draftAcceptance: null,
        reviewComments: [{ color: "pink", body: "Keep: we staff a 24x7 operations cell from day one so every incident has a named owner.", reviewer: "Pat" }],
        debriefWeaknesses: [{ agency: "GSA", weaknesses: "Thin risk register.", improvements: "Name owners." }],
        winnerGaps: [],
      },
    };
    const { intel: out, dropped } = screenPatternIntel(intel, golden);
    expect(dropped).toBe(3);
    expect(out.winningPatterns.map((p) => p.provenance)).toEqual(["won_proposal · Other"]);
    expect(out.lostPatterns).toHaveLength(1);
    expect(out.editFeedback?.preferredPhrases).toEqual(["single accountable lead"]);
    expect(out.writingSignals?.reviewComments).toEqual([]);
    expect(out.writingSignals?.debriefWeaknesses).toHaveLength(1);
  });

  it("measures how much of the winner reached the prompt", () => {
    expect(promptLeak(`Context:\n${WINNER}`, golden)).toBe(1);
    expect(promptLeak("Draft a technical approach for a cloud migration.", golden)).toBe(0);
    const half = promptLeak(WINNER.slice(0, Math.floor(WINNER.length / 2)), golden);
    expect(half).toBeGreaterThan(0.3);
    expect(half).toBeLessThan(0.7);
    expect(promptLeak("anything", goldenOf("too short"))).toBe(0);
  });
});
