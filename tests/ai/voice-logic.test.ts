/**
 * BL-FB-GEN-VOICE — an author's voice, pure parts: two contrasting
 * writers measure differently, read as different traits, and produce
 * different guidance; too little text produces no profile.
 */
import { describe, expect, it } from "vitest";
import {
  VOICE_LIMITS,
  analyzeVoice,
  authorComparisonSummary,
  authorDifferences,
  sanitizeVolumeStyles,
  volumeStyleGuidance,
  authoredSentences,
  buildVoiceFixHint,
  compareVoice,
  describeVoice,
  houseStyleGuidance,
  measureVoice,
  sampleWordCount,
  voiceCheckSummary,
  voiceGuidance,
} from "@/lib/voice-logic";

const PUNCHY = Array.from(
  { length: 14 },
  (_, i) =>
    `We fix the backlog first. Our team runs the help desk every day. We measure every ticket. We cut the wait to ten minutes. ${i % 2 ? "We report the numbers weekly." : "You see the dashboard live."} We own the outcome, and we say so. First, we baseline. Then we cut.`,
).join("\n\n");

const FORMAL = Array.from(
  { length: 10 },
  (_, i) =>
    `The modernization initiative will be implemented in accordance with the established governance framework, and the associated documentation shall be delivered by the designated personnel in alignment with the organizational transformation roadmap. ${i % 2 ? "Comprehensive stakeholder engagement is anticipated to be facilitated throughout the implementation lifecycle." : "The methodology has been validated through independent verification activities."} Risks are identified, categorized and mitigated through the configuration management process that was established during the transition period.`,
).join("\n\n");

describe("voice logic", () => {
  it("returns no profile for too little text and counts sample words", () => {
    expect(analyzeVoice(["We fix the backlog first."])).toBeNull();
    expect(sampleWordCount("One two three — 4 five.")).toBe(5);
    expect(analyzeVoice([PUNCHY])).not.toBeNull();
  });

  it("measures two writers differently and reads the difference as traits", () => {
    const p = analyzeVoice([PUNCHY])!;
    const f = analyzeVoice([FORMAL])!;
    expect(p.words).toBeGreaterThanOrEqual(VOICE_LIMITS.minProfileWords);
    expect(p.avgSentenceLength).toBeLessThan(10);
    expect(f.avgSentenceLength).toBeGreaterThan(18);
    expect(p.passiveRate).toBeLessThan(0.1);
    expect(f.passiveRate).toBeGreaterThan(0.3);
    expect(p.longWordRate).toBeLessThan(f.longWordRate);
    expect(p.wePerThousand).toBeGreaterThan(80);
    expect(f.wePerThousand).toBe(0);
    expect(p.youPerThousand).toBeGreaterThan(8);
    expect(p.openers).toContain("we");
    expect(p.phrases.length).toBeGreaterThan(0);
    expect(f.vocabulary).toContain("established");

    const pt = describeVoice(p);
    const ft = describeVoice(f);
    expect(pt).toContain("Active voice almost throughout");
    expect(pt).toContain('Writes as "we" — team-first');
    expect(pt).toContain("Plain words over jargon");
    expect(pt.some((t) => t.startsWith("Short, direct sentences"))).toBe(true);
    expect(ft).toContain("Comfortable with passive constructions");
    expect(ft).toContain("Technical, polysyllabic vocabulary");
    expect(ft.some((t) => t.startsWith("Medium-length sentences"))).toBe(true);
    expect(ft).toContain("No contractions — formal register");
  });

  it("writes guidance the drafter can follow, with the author's notes and the facts rule", () => {
    const m = analyzeVoice([PUNCHY])!;
    const g = voiceGuidance({ authorName: "Sarah Chen", metrics: m, traits: describeVoice(m), custom: "  Never say leverage.  Lead with the outcome. " });
    const lines = g.split("\n");
    expect(lines[0]).toBe("Write in Sarah Chen's voice — this section is theirs, and it must read as though they wrote it:");
    expect(g).toContain("- Active voice throughout; recast any passive sentence.");
    expect(g).toContain('- Speak as "we" / "our team".');
    expect(g).toContain("- No contractions.");
    expect(g).toContain("- Sarah Chen's own notes: Never say leverage. Lead with the outcome.");
    expect(lines[lines.length - 1]).toMatch(/^- Voice changes how things are said, never what is said/);
    expect(g.length).toBeLessThanOrEqual(VOICE_LIMITS.maxGuidanceChars);

    const traitsOnly = voiceGuidance({ authorName: "", metrics: null, traits: ["Plain words over jargon"] });
    expect(traitsOnly).toContain("Write in the author's voice");
    expect(traitsOnly).toContain("- Plain words over jargon.");
  });

  it("measures a short draft and finds where it departs from the author", () => {
    expect(measureVoice("Too short to compare.")).toBeNull();
    const profile = analyzeVoice([PUNCHY])!;
    const formalDraft = measureVoice(FORMAL.split("\n\n").slice(0, 3).join("\n\n"))!;
    expect(formalDraft).not.toBeNull();
    const findings = compareVoice(formalDraft, profile);
    const kinds = findings.map((f) => f.kind);
    expect(kinds).toContain("sentence_length");
    expect(kinds).toContain("passive");
    expect(kinds).toContain("vocabulary");
    expect(kinds).toContain("we");
    expect(findings[0]!.severity).toBe("high");
    expect(findings.find((f) => f.kind === "sentence_length")?.label).toBe("Sentences run long");
    // The author's own prose reads like them.
    const own = measureVoice(PUNCHY.split("\n\n").slice(0, 3).join("\n\n"))!;
    expect(compareVoice(own, profile)).toEqual([]);

    expect(voiceCheckSummary([], "Sarah Chen")).toBe("reads like Sarah Chen");
    expect(voiceCheckSummary(findings, "Sarah Chen")).toMatch(/^\d+ differences from Sarah Chen's voice$/);
    const hint = buildVoiceFixHint(findings, "Sarah Chen");
    expect(hint.split("\n")[0]).toBe("Bring this draft into Sarah Chen's voice without changing its facts, structure or length:");
    expect(hint).toContain("- Recast passive sentences in the active voice");
    expect(hint).toMatch(/never what is said/);
    expect(buildVoiceFixHint([], "x")).toBe("");
  });

  it("keeps only the sentences the author wrote, not the AI's that they kept", () => {
    const draft = "Our team will modernize the help desk in three phases. Each phase ends with a measured cutover. The transition plan names every risk owner.";
    const saved =
      "Our team will modernize the help desk in three phases. We fix the backlog first, because nothing else matters until the queue is gone. Each phase ends with a measured cut-over. The transition plan names every risk owner and a date.";
    expect(authoredSentences(saved, [draft])).toEqual([
      "We fix the backlog first, because nothing else matters until the queue is gone.",
      "The transition plan names every risk owner and a date.",
    ]);
    expect(authoredSentences(saved, [])).toHaveLength(4);
    expect(authoredSentences("", [draft])).toEqual([]);
  });

  it("turns the team's rules into guidance, one rule per line", () => {
    const g = houseStyleGuidance("Acme Federal", "- Never say leverage.\n\n2) Open with the customer's outcome.\n   \n   Name   the agency as the RFP does.");
    const lines = g.split("\n");
    expect(lines[0]).toBe("House style for Acme Federal — every section follows these rules, whoever the author is:");
    expect(lines.slice(1, 4)).toEqual(["- Never say leverage.", "- Open with the customer's outcome.", "- Name the agency as the RFP does."]);
    expect(lines[lines.length - 1]).toMatch(/^- House style governs how things are said, never what is said/);
    expect(houseStyleGuidance("Acme", "  \n ")).toBe("");
  });
});

describe("Slice 3 — house style per volume", () => {
  it("keeps known volumes only, trimmed, and drops empty ones", () => {
    expect(sanitizeVolumeStyles({ pricing: "  Firm prices.  ", technical: "", bogus: "x", management: 5 })).toEqual({ pricing: "Firm prices." });
    expect(sanitizeVolumeStyles(null)).toEqual({});
    expect(sanitizeVolumeStyles({ technical: "x".repeat(VOICE_LIMITS.maxHouseStyleChars + 50) }).technical).toHaveLength(VOICE_LIMITS.maxHouseStyleChars);
  });

  it("names the volume and lists its rules", () => {
    const g = volumeStyleGuidance("Acme", "pricing", "- State firm prices.\n\n2) Never round rates.");
    expect(g.split("\n")).toEqual([
      "House style for Acme's Price volume — on top of the team rules, for sections in this volume:",
      "- State firm prices.",
      "- Never round rates.",
    ]);
    expect(volumeStyleGuidance("Acme", "technical", "  \n ")).toBe("");
  });
});

describe("Slice 3 — two authors side by side", () => {
  const base = analyzeVoice([Array.from({ length: 40 }, () => "We fix the backlog first and we measure every ticket.").join(" ")])!;

  it("reads two alike authors as one voice", () => {
    expect(authorDifferences(base, base)).toEqual([]);
    expect(authorComparisonSummary("Ana", "Ben", [])).toBe("Ana and Ben read as one voice on this proposal.");
  });

  it("flags the measures an evaluator would notice, both ways round", () => {
    const other = { ...base, avgSentenceLength: base.avgSentenceLength * 2, passiveRate: base.passiveRate + 0.3, wePerThousand: 0, contractionsPerThousand: 5 };
    const diffs = authorDifferences(base, other);
    expect(diffs.map((d) => d.kind)).toEqual(["sentence_length", "passive", "we", "contractions"]);
    expect(authorDifferences(other, base).map((d) => d.kind)).toEqual(diffs.map((d) => d.kind));
    expect(diffs[0]).toMatchObject({ label: "Sentence length", a: `${Math.round(base.avgSentenceLength)} words` });
    expect(authorComparisonSummary("Ana", "Ben", diffs)).toBe("4 differences an evaluator may notice between Ana's and Ben's sections.");
  });
});
