/**
 * BL-FB-GEN-VOICE — an author's voice, pure parts: two contrasting
 * writers measure differently, read as different traits, and produce
 * different guidance; too little text produces no profile.
 */
import { describe, expect, it } from "vitest";
import { VOICE_LIMITS, analyzeVoice, describeVoice, sampleWordCount, voiceGuidance } from "@/lib/voice-logic";

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
    expect(ft).toContain("Varies sentence length for rhythm");
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
});
