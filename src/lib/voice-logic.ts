/**
 * BL-FB-GEN-VOICE — an author's writing voice, pure parts.
 *
 * "This reads like AI" is usually a voice problem: every author's
 * sections come back in the same register. The fix is to measure how
 * each author actually writes — sentence length and rhythm, active vs
 * passive, plain vs technical words, "we" vs "you", contractions,
 * numbers, lists, favourite openers and phrases — and hand the drafter
 * and chat that profile as guidance whenever they work a section the
 * author owns. No I/O here; the server side is `voice.ts`.
 */
import type { VoiceMetrics } from "@/db/schema";
import { countSyllables, isPassiveSentence, proseWords, splitSentences } from "@/lib/tone-check";

export const VOICE_LIMITS = {
  /** A section or pasted text shorter than this says little about style. */
  minSampleWords: 120,
  maxSampleChars: 20_000,
  maxSamples: 40,
  /** Below this across all samples no profile is built. */
  minProfileWords: 300,
  maxGuidanceChars: 1_400,
  maxCustomChars: 600,
  maxTitleChars: 120,
} as const;

const STOP = new Set(
  "a an the and or but if then than that this these those of to in on at for from by with as is are was were be been being it its we our us you your they their them he she his her i my me do does did done have has had will would shall should can could may might must not no nor so such very into onto over under about after before between through during above below out up down off again further here there when where why how all any both each few more most other some own same too also just only".split(" "),
);
const OPENER_WORDS = new Set(
  "we our the this that these those in to for by with as a an it first second finally however therefore additionally moreover because when while although through our team".split(" "),
);

const tokens = (text: string) => proseWords(text).map((w) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, "")).filter(Boolean);
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const per1000 = (n: number, words: number) => (words > 0 ? round((n / words) * 1000) : 0);

function topN(counts: Map<string, number>, n: number, min = 2): string[] {
  return Array.from(counts.entries())
    .filter(([, c]) => c >= min)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([k]) => k);
}

/** Measure how these texts are written; null when there is too little to read. */
export function analyzeVoice(samples: readonly string[]): VoiceMetrics | null {
  const paragraphs = samples.flatMap((s) => s.split(/\n\s*\n|\n(?=\s*(?:[-•*]|\d+[.)])\s)/).map((p) => p.trim()).filter((p) => p.length > 0));
  const text = samples.join("\n\n");
  const words = tokens(text);
  if (words.length < VOICE_LIMITS.minProfileWords) return null;
  const sentences = splitSentences(text).filter((s) => tokens(s).length >= 2);
  const lengths = sentences.map((s) => tokens(s).length);
  const avg = lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length);
  const spread = Math.sqrt(lengths.reduce((a, b) => a + (b - avg) ** 2, 0) / Math.max(1, lengths.length));
  const passive = sentences.filter((s) => isPassiveSentence(s)).length;
  const longWords = words.filter((w) => countSyllables(w) >= 3).length;
  const count = (re: RegExp) => words.filter((w) => re.test(w)).length;
  const listParagraphs = paragraphs.filter((p) => /^(?:[-•*]|\d+[.)])\s/.test(p)).length;

  const openerCounts = new Map<string, number>();
  for (const s of sentences) {
    const first = tokens(s)[0];
    if (first && (OPENER_WORDS.has(first) || !STOP.has(first))) openerCounts.set(first, (openerCounts.get(first) ?? 0) + 1);
  }
  const phraseCounts = new Map<string, number>();
  for (let i = 0; i < words.length - 1; i++) {
    const a = words[i]!;
    const b = words[i + 1]!;
    if (STOP.has(a) && STOP.has(b)) continue;
    if (/^\d+$/.test(a) || /^\d+$/.test(b)) continue;
    phraseCounts.set(`${a} ${b}`, (phraseCounts.get(`${a} ${b}`) ?? 0) + 1);
    const c = words[i + 2];
    if (c && !(STOP.has(a) && STOP.has(c)) && !/^\d+$/.test(c)) phraseCounts.set(`${a} ${b} ${c}`, (phraseCounts.get(`${a} ${b} ${c}`) ?? 0) + 1);
  }
  const vocabCounts = new Map<string, number>();
  for (const w of words) if (!STOP.has(w) && w.length >= 5 && !/^\d/.test(w)) vocabCounts.set(w, (vocabCounts.get(w) ?? 0) + 1);

  return {
    words: words.length,
    sentences: sentences.length,
    paragraphs: paragraphs.length,
    avgSentenceLength: round(avg),
    sentenceLengthSpread: round(spread),
    avgParagraphSentences: round(sentences.length / Math.max(1, paragraphs.length)),
    longWordRate: round(longWords / words.length, 3),
    passiveRate: round(passive / Math.max(1, sentences.length), 3),
    wePerThousand: per1000(count(/^(?:we|our|ours|us)$/), words.length),
    youPerThousand: per1000(count(/^(?:you|your|yours)$/), words.length),
    iPerThousand: per1000(count(/^(?:i|my|mine|me)$/), words.length),
    contractionsPerThousand: per1000(count(/\w'(?:t|s|re|ve|ll|d|m)$/), words.length),
    numbersPerThousand: per1000(count(/\d/), words.length),
    listRate: round(listParagraphs / Math.max(1, paragraphs.length), 3),
    openers: topN(openerCounts, 4, 3),
    phrases: topN(phraseCounts, 6, 3).filter((p) => p.split(" ").length >= 2),
    vocabulary: topN(vocabCounts, 8, 3),
  };
}

/** The profile as the author would recognise it: a handful of plain traits. */
export function describeVoice(m: VoiceMetrics): string[] {
  const t: string[] = [];
  t.push(
    m.avgSentenceLength < 14
      ? `Short, direct sentences (about ${Math.round(m.avgSentenceLength)} words)`
      : m.avgSentenceLength <= 22
        ? `Medium-length sentences (about ${Math.round(m.avgSentenceLength)} words)`
        : `Long, layered sentences (about ${Math.round(m.avgSentenceLength)} words)`,
  );
  if (m.sentenceLengthSpread >= 9) t.push("Varies sentence length for rhythm");
  else if (m.sentenceLengthSpread <= 4) t.push("Even, steady sentence rhythm");
  t.push(m.passiveRate < 0.08 ? "Active voice almost throughout" : m.passiveRate < 0.2 ? "Mostly active voice" : "Comfortable with passive constructions");
  if (m.longWordRate < 0.12) t.push("Plain words over jargon");
  else if (m.longWordRate > 0.2) t.push("Technical, polysyllabic vocabulary");
  if (m.wePerThousand >= 25) t.push("Writes as \"we\" — team-first");
  if (m.youPerThousand >= 8) t.push("Addresses the reader as \"you\"");
  if (m.iPerThousand >= 8) t.push("First person singular shows through");
  t.push(m.contractionsPerThousand >= 3 ? "Uses contractions — conversational register" : "No contractions — formal register");
  if (m.numbersPerThousand >= 15) t.push("Leans on numbers and metrics");
  if (m.listRate >= 0.25) t.push("Breaks content into lists");
  if (m.openers.length >= 2) t.push(`Often opens sentences with: ${m.openers.map((o) => `"${o}"`).join(", ")}`);
  if (m.phrases.length >= 2) t.push(`Recurring phrases: ${m.phrases.slice(0, 4).map((p) => `"${p}"`).join(", ")}`);
  return t;
}

/**
 * The prompt fragment the drafter and chat receive: measurable targets
 * first, habits second, the author's own notes last, and a reminder
 * that voice never adds facts.
 */
export function voiceGuidance(input: { authorName: string; metrics: VoiceMetrics | null; traits: readonly string[]; custom?: string }): string {
  const name = input.authorName.trim() || "the author";
  const m = input.metrics;
  const lines: string[] = [`Write in ${name}'s voice — this section is theirs, and it must read as though they wrote it:`];
  if (m) {
    lines.push(`- Sentences average about ${Math.round(m.avgSentenceLength)} words${m.sentenceLengthSpread >= 9 ? ", with deliberate variation between short and long" : m.sentenceLengthSpread <= 4 ? ", kept even in length" : ""}.`);
    lines.push(m.passiveRate < 0.08 ? "- Active voice throughout; recast any passive sentence." : m.passiveRate < 0.2 ? `- Mostly active voice (passive in at most ${Math.round(m.passiveRate * 100)}% of sentences).` : "- Passive constructions are acceptable where they read naturally.");
    lines.push(m.longWordRate < 0.12 ? "- Plain, concrete words; avoid jargon and Latinate abstractions." : m.longWordRate > 0.2 ? "- Precise technical vocabulary is in character; do not dumb it down." : "- Balanced vocabulary: technical where the subject demands, plain elsewhere.");
    if (m.wePerThousand >= 25) lines.push('- Speak as "we" / "our team".');
    if (m.youPerThousand >= 8) lines.push('- Address the evaluator directly as "you" where natural.');
    lines.push(m.contractionsPerThousand >= 3 ? "- Contractions are fine." : "- No contractions.");
    if (m.numbersPerThousand >= 15) lines.push("- Carry the argument with numbers and metrics where the facts allow.");
    if (m.listRate >= 0.25) lines.push("- Use lists for steps and enumerations rather than long paragraphs.");
    if (m.openers.length >= 2) lines.push(`- Typical sentence openers (use sparingly, not every sentence): ${m.openers.map((o) => `"${o}"`).join(", ")}.`);
    if (m.phrases.length >= 2) lines.push(`- Phrases ${name} tends to use (at most once or twice, where they fit): ${m.phrases.slice(0, 4).map((p) => `"${p}"`).join(", ")}.`);
  } else if (input.traits.length > 0) {
    for (const trait of input.traits.slice(0, 6)) lines.push(`- ${trait}.`);
  }
  const custom = (input.custom ?? "").trim();
  if (custom) lines.push(`- ${name}'s own notes: ${custom.replace(/\s+/g, " ").slice(0, VOICE_LIMITS.maxCustomChars)}`);
  lines.push("- Voice changes how things are said, never what is said: every fact still comes from the snapshot, and the brief and requirements still win.");
  return lines.join("\n").slice(0, VOICE_LIMITS.maxGuidanceChars);
}

/** Word count the sample gate uses. */
export function sampleWordCount(text: string): number {
  return tokens(text).length;
}
