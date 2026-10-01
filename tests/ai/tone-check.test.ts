/**
 * BL-FB-SCAN-TONE — tone and reading-level check, pure parts.
 */
import { describe, expect, it } from "vitest";
import {
  TONE_FIX_HINT_MAX,
  TONE_THRESHOLDS,
  buildToneFixHint,
  checkTone,
  countSyllables,
  findMarketingPhrases,
  fleschKincaidGrade,
  isPassiveSentence,
  splitSentences,
  toneSummary,
} from "@/lib/tone-check";

const PLAIN =
  "We run the SOC. Our team of ten analysts watches the network all day. We fix each alert within one hour. The Navy signed off on the plan last year. We train new staff in two weeks. Each report goes to the program office on Friday. The lead keeps the risk log. We meet the customer every month.";

const FLUFF =
  "Our world-class organization leverages a robust, state-of-the-art methodology. The comprehensive implementation framework was architected by our multidisciplinary enterprise transformation specialists to systematically operationalize institutional modernization objectives across heterogeneous infrastructure environments. Deliverables are reviewed by the quality organization. Stakeholder communications are coordinated by the program management office. The methodology has been validated on comparable federal engagements. We leverage unparalleled expertise.";

describe("tone check", () => {
  it("counts syllables within a syllable for ordinary words", () => {
    expect(countSyllables("the")).toBe(1);
    expect(countSyllables("table")).toBe(2);
    expect(countSyllables("proposal")).toBe(3);
    expect(countSyllables("government")).toBe(3);
    expect(countSyllables("created")).toBeGreaterThanOrEqual(2);
    expect(countSyllables("evaluation")).toBeGreaterThanOrEqual(4);
    expect(countSyllables("2026")).toBe(1);
    expect(countSyllables("—")).toBe(0);
  });

  it("splits sentences past abbreviations, decimals, headings and list markers", () => {
    expect(splitSentences("Dr. Smith leads the SOC. We migrated 3.5 TB in Q1. The U.S. Navy accepted it.")).toHaveLength(3);
    expect(splitSentences("Technical Approach\nWe do X. We do Y.")).toEqual(["We do X.", "We do Y."]);
    expect(splitSentences("1. Scope.\n2. Deliverables and the monthly reports")).toEqual([
      "Scope.",
      "Deliverables and the monthly reports",
    ]);
    expect(splitSentences('He said "Go." Then we left.')).toHaveLength(2);
    expect(splitSentences("")).toEqual([]);
  });

  it("recognises the passive voice by shape", () => {
    expect(isPassiveSentence("The system was designed by the team.")).toBe(true);
    expect(isPassiveSentence("Reports are not fully reviewed before release.")).toBe(true);
    expect(isPassiveSentence("The plan has been built.")).toBe(true);
    expect(isPassiveSentence("Our approach is proven on three contracts.")).toBe(true);
    expect(isPassiveSentence("The team designed the system.")).toBe(false);
    expect(isPassiveSentence("We need the data by Friday.")).toBe(false);
    expect(isPassiveSentence("This is indeed the case.")).toBe(false);
    expect(isPassiveSentence("The office is red.")).toBe(false);
  });

  it("finds marketing phrases in every form and skips technical uses", () => {
    const hits = findMarketingPhrases(
      "A world-class team. World class support. It leverages data while leveraging staff. A unique identifier and a unique approach. Robust regression and a robust process.",
    );
    expect(hits).toEqual([
      { phrase: "leverage", count: 2, suggestion: "use" },
      { phrase: "world-class", count: 2, suggestion: "name the credential or metric that earns it" },
      { phrase: "robust", count: 1, suggestion: "say what it withstands" },
      { phrase: "unique", count: 1, suggestion: "say what no one else does" },
    ]);
    expect(findMarketingPhrases("We use the data.")).toEqual([]);
  });

  it("computes the Flesch-Kincaid grade", () => {
    expect(fleschKincaidGrade(0, 0, 0)).toBe(0);
    // 100 words, 10 sentences, 150 syllables → 3.9 + 17.7 − 15.59 = 6.0
    expect(fleschKincaidGrade(100, 10, 150)).toBe(6);
    expect(fleschKincaidGrade(100, 4, 230)).toBeGreaterThan(TONE_THRESHOLDS.gradeMax);
  });

  it("passes plain active prose and flags fluff", () => {
    const plain = checkTone(PLAIN);
    expect(plain.tooShort).toBe(false);
    expect(plain.sentences).toBe(8);
    expect(plain.passiveSentences).toBe(0);
    expect(plain.gradeLevel).not.toBeNull();
    expect(plain.gradeLevel!).toBeLessThan(8);
    expect(plain.marketing).toEqual([]);
    expect(plain.flags).toEqual([]);
    expect(buildToneFixHint(plain)).toBe("");
    expect(toneSummary(plain)).toMatch(/^grade \d+ · 0% passive · no marketing phrases$/);

    const fluff = checkTone(FLUFF);
    expect(fluff.tooShort).toBe(false);
    expect(fluff.sentences).toBe(6);
    expect(fluff.passiveSentences).toBe(4);
    expect(fluff.passiveRate).toBeCloseTo(0.67, 2);
    expect(fluff.passiveExamples).toHaveLength(3);
    expect(fluff.gradeLevel!).toBeGreaterThan(TONE_THRESHOLDS.gradeMax);
    expect(fluff.marketing.map((m) => m.phrase)).toEqual(
      expect.arrayContaining(["world-class", "leverage", "robust", "state-of-the-art", "unparalleled"]),
    );
    expect(fluff.flags.map((f) => f.kind).sort()).toEqual(["marketing", "passive", "reading_level"]);
    expect(fluff.flags.find((f) => f.kind === "passive")?.severity).toBe("high");
    expect(toneSummary(fluff)).toMatch(/^grade \d+ · 67% passive · 6 flagged phrases$/);

    const hint = buildToneFixHint(fluff);
    expect(hint.startsWith("Fix the tone of this draft without changing its facts")).toBe(true);
    expect(hint).toContain('"leverage" (×2 — use)');
    expect(hint).toContain("67% of sentences are passive");
    expect(hint).toContain("grade 14 or below");
    expect(hint.length).toBeLessThanOrEqual(TONE_FIX_HINT_MAX);
  });

  it("still lists marketing phrases in a short paragraph and bounds the hint", () => {
    const short = checkTone("We are pleased to offer a seamless, turnkey, best-in-class solution.");
    expect(short.tooShort).toBe(true);
    expect(short.gradeLevel).toBeNull();
    expect(short.passiveRate).toBeNull();
    expect(short.flags.map((f) => f.kind)).toEqual(["marketing"]);
    expect(toneSummary(short)).toBe("4 flagged phrases · 40+ words to judge reading level");

    const longFluff = checkTone(`${FLUFF} `.repeat(12));
    const hint = buildToneFixHint(longFluff);
    expect(hint.length).toBeLessThanOrEqual(TONE_FIX_HINT_MAX);
  });
});
