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
  /** Slice 2 — a draft shorter than this is not compared against the profile. */
  checkMinWords: 60,
  /** Slice 2 — the team's house style, as the admin types it. */
  maxHouseStyleChars: 1_200,
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
  if (tokens(samples.join("\n\n")).length < VOICE_LIMITS.minProfileWords) return null;
  return measure(samples);
}

/** Slice 2 — measure one draft for the voice check; null under the check's smaller minimum. */
export function measureVoice(text: string): VoiceMetrics | null {
  if (tokens(text).length < VOICE_LIMITS.checkMinWords) return null;
  return measure([text]);
}

function measure(samples: readonly string[]): VoiceMetrics {
  const paragraphs = samples.flatMap((s) => s.split(/\n\s*\n|\n(?=\s*(?:[-•*]|\d+[.)])\s)/).map((p) => p.trim()).filter((p) => p.length > 0));
  const text = samples.join("\n\n");
  const words = tokens(text);
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

// ── Slice 2 — learn from edits, check a draft, house style ──────────

/** An author's profile is rebuilt from a save at most this often. */
export const AUTO_REBUILD_MIN_INTERVAL_MS = 60 * 60 * 1000;

/**
 * The sentences of a saved section the author wrote themselves: those
 * found in no AI draft of the section, exactly or nearly (four words in
 * five shared with a draft sentence of similar length). What an author
 * accepted verbatim is the model's voice, not theirs, and must not train
 * their profile.
 */
export function authoredSentences(savedText: string, draftTexts: readonly string[]): string[] {
  const drafts = draftTexts.flatMap((d) => splitSentences(d)).map((s) => tokens(s)).filter((t) => t.length > 0);
  const exact = new Set(drafts.map((t) => t.join(" ")));
  const out: string[] = [];
  for (const sentence of splitSentences(savedText)) {
    const t = tokens(sentence);
    if (t.length === 0) continue;
    if (exact.has(t.join(" "))) continue;
    const mine = new Set(t);
    const nearly = drafts.some((d) => {
      if (d.length < t.length * 0.6 || d.length > t.length * 1.6) return false;
      let shared = 0;
      for (const w of new Set(d)) if (mine.has(w)) shared += 1;
      return shared / mine.size >= 0.8;
    });
    if (!nearly) out.push(sentence);
  }
  return out;
}

export type VoiceFindingKind = "sentence_length" | "passive" | "vocabulary" | "we" | "you" | "contractions" | "numbers" | "lists";
export type VoiceFinding = {
  kind: VoiceFindingKind;
  severity: "high" | "medium";
  /** Short, for the panel row. */
  label: string;
  /** The measurement behind it. */
  detail: string;
  /** The instruction Improve mode receives. */
  fix: string;
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Where a draft departs from how the author writes; empty when it reads like them. */
export function compareVoice(draft: VoiceMetrics, profile: VoiceMetrics): VoiceFinding[] {
  const f: VoiceFinding[] = [];
  const d = Math.round(draft.avgSentenceLength);
  const p = Math.round(profile.avgSentenceLength);
  const ratio = draft.avgSentenceLength / Math.max(1, profile.avgSentenceLength);
  if (ratio >= 1.4) {
    f.push({ kind: "sentence_length", severity: ratio >= 1.8 ? "high" : "medium", label: "Sentences run long", detail: `${d} words per sentence; the author averages ${p}`, fix: `Shorten sentences to about ${p} words on average (now ${d}); split them rather than cut content.` });
  } else if (ratio <= 0.65) {
    f.push({ kind: "sentence_length", severity: ratio <= 0.5 ? "high" : "medium", label: "Sentences run short", detail: `${d} words per sentence; the author averages ${p}`, fix: `Let sentences run to about ${p} words on average (now ${d}); join the choppy ones.` });
  }
  const passiveGap = draft.passiveRate - profile.passiveRate;
  if (draft.passiveRate >= 0.15 && passiveGap >= 0.15) {
    f.push({ kind: "passive", severity: passiveGap >= 0.3 ? "high" : "medium", label: "More passive than the author writes", detail: `${pct(draft.passiveRate)} of sentences are passive; the author writes ${pct(profile.passiveRate)}`, fix: `Recast passive sentences in the active voice with a named actor (${pct(draft.passiveRate)} passive now; the author writes ${pct(profile.passiveRate)}).` });
  }
  const vocabGap = draft.longWordRate - profile.longWordRate;
  if (vocabGap >= 0.06) {
    f.push({ kind: "vocabulary", severity: vocabGap >= 0.1 ? "high" : "medium", label: "Heavier vocabulary than the author's", detail: `${pct(draft.longWordRate)} long words; the author runs ${pct(profile.longWordRate)}`, fix: `Replace polysyllabic and Latinate words with the plain ones the author uses (${pct(draft.longWordRate)} long words now; the author runs ${pct(profile.longWordRate)}).` });
  } else if (vocabGap <= -0.08 && profile.longWordRate > 0.2) {
    f.push({ kind: "vocabulary", severity: "medium", label: "Plainer than the author writes", detail: `${pct(draft.longWordRate)} long words; the author runs ${pct(profile.longWordRate)}`, fix: "Use the precise technical vocabulary the author uses; do not simplify terms of art." });
  }
  if (profile.wePerThousand >= 25 && draft.wePerThousand < profile.wePerThousand * 0.4) {
    f.push({ kind: "we", severity: "medium", label: 'Fewer "we" than the author writes', detail: `${draft.wePerThousand} per 1,000 words; the author writes ${profile.wePerThousand}`, fix: 'Speak as "we" / "our team" where the draft names the company or hides the actor.' });
  } else if (profile.wePerThousand < 8 && draft.wePerThousand >= 25) {
    f.push({ kind: "we", severity: "medium", label: 'More "we" than the author writes', detail: `${draft.wePerThousand} per 1,000 words; the author writes ${profile.wePerThousand}`, fix: 'Cut most "we" / "our" openers; the author names the work, not the team.' });
  }
  if (profile.youPerThousand >= 8 && draft.youPerThousand < 2) {
    f.push({ kind: "you", severity: "medium", label: 'The author addresses the evaluator as "you"', detail: `${draft.youPerThousand} per 1,000 words; the author writes ${profile.youPerThousand}`, fix: 'Address the evaluator directly as "you" where it reads naturally.' });
  }
  if (profile.contractionsPerThousand < 1 && draft.contractionsPerThousand >= 3) {
    f.push({ kind: "contractions", severity: "medium", label: "Contractions where the author uses none", detail: `${draft.contractionsPerThousand} per 1,000 words`, fix: "Expand every contraction; the author writes in a formal register." });
  }
  if (profile.numbersPerThousand >= 15 && draft.numbersPerThousand < profile.numbersPerThousand * 0.4) {
    f.push({ kind: "numbers", severity: "medium", label: "Fewer numbers than the author leans on", detail: `${draft.numbersPerThousand} per 1,000 words; the author writes ${profile.numbersPerThousand}`, fix: "Carry the argument with the numbers and metrics the snapshot already contains; add none that are not there." });
  }
  if (profile.listRate >= 0.25 && draft.listRate === 0 && draft.paragraphs >= 3) {
    f.push({ kind: "lists", severity: "medium", label: "The author breaks this kind of content into lists", detail: `no lists in ${draft.paragraphs} paragraphs; ${pct(profile.listRate)} of the author's paragraphs are lists`, fix: "Turn enumerations and steps into lists rather than long paragraphs." });
  }
  return f.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
}

export function voiceCheckSummary(findings: readonly VoiceFinding[], authorName: string): string {
  const name = authorName.trim() || "the author";
  if (findings.length === 0) return `reads like ${name}`;
  return `${findings.length} difference${findings.length === 1 ? "" : "s"} from ${name}'s voice`;
}

/** Improve-mode guidance from the findings: how to say it, never what. Empty when nothing is flagged. */
export function buildVoiceFixHint(findings: readonly VoiceFinding[], authorName: string): string {
  if (findings.length === 0) return "";
  const name = authorName.trim() || "the author";
  const lines = [`Bring this draft into ${name}'s voice without changing its facts, structure or length:`];
  for (const f of findings.slice(0, 6)) lines.push(`- ${f.fix}`);
  lines.push("- Voice changes how things are said, never what is said: keep every fact, number and citation exactly as it is.");
  return lines.join("\n");
}

/** The team-wide rules the drafter and chat receive before any author's voice; empty when none are set. */
export function houseStyleGuidance(orgName: string, text: string): string {
  const rules = text
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map((l) => l.replace(/^[\s\-•*]+|^\s*\d+[.)]\s*/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (rules.length === 0) return "";
  const name = orgName.trim() || "the team";
  const lines = [`House style for ${name} — every section follows these rules, whoever the author is:`];
  for (const r of rules.slice(0, 20)) lines.push(`- ${r}`);
  lines.push("- House style governs how things are said, never what is said; the brief and the requirements still win.");
  return lines.join("\n");
}
