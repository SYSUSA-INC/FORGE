/**
 * BL-FB-SCAN-TONE — tone and reading-level check for a section.
 *
 * Three heuristics an evaluator would apply by ear, run in the browser
 * on the live text (no model call): marketing language that claims
 * without evidence, the share of sentences in the passive voice, and
 * the Flesch-Kincaid grade level against the federal evaluator standard
 * (college sophomore). The report feeds a "Fix with AI" hint that opens
 * Improve mode with the offending phrases named. Pure; unit-tested.
 */

export const TONE_THRESHOLDS = {
  /** Flesch-Kincaid grade above which the prose reads harder than a college sophomore. */
  gradeMax: 14,
  /** Share of sentences in the passive voice tolerated. */
  passiveRateMax: 0.2,
  /** Below this many prose words nothing is judged. */
  minWords: 40,
  /** Sentences needed before the passive share means anything. */
  minSentencesForPassive: 5,
} as const;

/** The click-to-fix hint is bounded; the draft route caps it at the same size. */
export const TONE_FIX_HINT_MAX = 2000;

export type MarketingPhrase = {
  /** The canonical form shown to the author. */
  phrase: string;
  /** What to write instead. */
  suggestion: string;
  /** Other spellings and inflections counted under the canonical form. */
  forms?: string[];
};

/**
 * Claims that carry no evidence. "unique identifier" and "robust
 * regression" are technical terms and are not counted.
 */
export const MARKETING_PHRASES: readonly MarketingPhrase[] = [
  { phrase: "world-class", suggestion: "name the credential or metric that earns it", forms: ["world class"] },
  { phrase: "best-in-class", suggestion: "say what it outperforms and by how much", forms: ["best in class", "best-of-breed", "best of breed"] },
  { phrase: "robust", suggestion: "say what it withstands" },
  { phrase: "leverage", suggestion: "use", forms: ["leverages", "leveraged", "leveraging"] },
  { phrase: "synergy", suggestion: "say which two things combine and what results", forms: ["synergies", "synergistic"] },
  { phrase: "cutting-edge", suggestion: "name the technology and its version", forms: ["cutting edge", "bleeding-edge", "bleeding edge"] },
  { phrase: "state-of-the-art", suggestion: "name the standard or the product", forms: ["state of the art"] },
  { phrase: "industry-leading", suggestion: "cite the ranking or the number", forms: ["industry leading", "market-leading", "market leading"] },
  { phrase: "seamless", suggestion: "say how the hand-off works", forms: ["seamlessly"] },
  { phrase: "innovative", suggestion: "describe what is new about it", forms: ["innovatively"] },
  { phrase: "unparalleled", suggestion: "give the comparison", forms: ["unrivaled", "unrivalled", "unmatched", "second to none"] },
  { phrase: "proven track record", suggestion: "cite the contract and the result", forms: ["track record of success"] },
  { phrase: "holistic", suggestion: "list what it covers", forms: ["holistically"] },
  { phrase: "turnkey", suggestion: "say what the customer does not have to do", forms: ["turn-key"] },
  { phrase: "paradigm", suggestion: "drop it", forms: ["paradigm shift", "paradigm-shifting"] },
  { phrase: "game-changing", suggestion: "state the measurable change", forms: ["game changing", "game changer", "game-changer"] },
  { phrase: "next-generation", suggestion: "name the generation and what changed", forms: ["next generation", "next-gen"] },
  { phrase: "we are pleased to", suggestion: "start with the fact", forms: ["we are excited to", "we are proud to", "we are delighted to"] },
  { phrase: "value-added", suggestion: "name the value", forms: ["value added", "value-add"] },
  { phrase: "revolutionary", suggestion: "state what changed", forms: ["revolutionize", "revolutionizes", "revolutionizing"] },
  { phrase: "unique", suggestion: "say what no one else does", forms: ["uniquely"] },
  { phrase: "thought leader", suggestion: "cite the publication or the standard body", forms: ["thought leaders", "thought leadership"] },
  { phrase: "empower", suggestion: "say what they can now do", forms: ["empowers", "empowered", "empowering"] },
  { phrase: "utilize", suggestion: "use", forms: ["utilizes", "utilized", "utilizing", "utilise", "utilises", "utilised", "utilising"] },
  { phrase: "in order to", suggestion: "to" },
  { phrase: "going forward", suggestion: "drop it" },
  { phrase: "a wide range of", suggestion: "list them or count them", forms: ["a broad range of", "a wide variety of", "a broad array of", "a wide array of"] },
  { phrase: "mission-critical", suggestion: "name the mission outcome at stake", forms: ["mission critical"] },
  { phrase: "customer-centric", suggestion: "say what the customer decides", forms: ["customer centric", "client-centric", "client centric"] },
  { phrase: "results-driven", suggestion: "cite the result", forms: ["results driven", "results-oriented", "results oriented"] },
];

/** Technical uses of otherwise-flagged words. */
const TECHNICAL_EXCEPTIONS: Record<string, RegExp> = {
  unique: /^(identifier|id|ids|key|keys|constraint|constraints|index|indexes|entity|entities)$/i,
  robust: /^(regression|statistics|statistical|estimator|estimators|standard)$/i,
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One regex per canonical phrase; hyphen and space are interchangeable. */
function phraseRegex(entry: MarketingPhrase): RegExp {
  const forms = [entry.phrase, ...(entry.forms ?? [])].map((f) =>
    escapeRe(f).replace(/[-\s]+/g, "[-\\s]+"),
  );
  return new RegExp(`\\b(?:${forms.join("|")})\\b(?:[-\\s]+(\\w+))?`, "gi");
}

const PHRASE_PATTERNS: readonly { entry: MarketingPhrase; re: RegExp }[] = MARKETING_PHRASES.map((entry) => ({
  entry,
  re: phraseRegex(entry),
}));

export type MarketingHit = { phrase: string; count: number; suggestion: string };

/** Marketing phrases found in the text, most frequent first. */
export function findMarketingPhrases(text: string): MarketingHit[] {
  const hits: MarketingHit[] = [];
  for (const { entry, re } of PHRASE_PATTERNS) {
    re.lastIndex = 0;
    let count = 0;
    const exception = TECHNICAL_EXCEPTIONS[entry.phrase];
    for (const m of text.matchAll(re)) {
      if (exception && m[1] && exception.test(m[1])) continue;
      count++;
    }
    if (count > 0) hits.push({ phrase: entry.phrase, count, suggestion: entry.suggestion });
  }
  return hits.sort((a, b) => b.count - a.count || a.phrase.localeCompare(b.phrase));
}

const ABBREVIATION = /(?:^|\s)(?:e\.g|i\.e|etc|vs|dr|mr|mrs|ms|no|inc|ltd|co|corp|u\.s|dept|approx|fig|sec|para|govt|gen|col|lt|sgt|st|jr|sr|ph\.d|cf|al|vol|rev|est|min|max|avg)\.$/i;

/**
 * Sentences of the prose. Each line is split on terminal punctuation
 * followed by a capital, digit or quote; abbreviations and decimals do
 * not end a sentence. Short lines without terminal punctuation
 * (headings, labels) are not prose and are left out.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;
    const tokens = line.split(" ");
    let buf: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i]!;
      buf.push(tok);
      const terminal = /[.!?]+["')\]]*$/.test(tok);
      if (!terminal) continue;
      if (ABBREVIATION.test(tok)) continue;
      const next = tokens[i + 1];
      if (next !== undefined && !/^["'(\[]?[A-Z0-9]/.test(next)) continue;
      push(buf.join(" "));
      buf = [];
    }
    if (buf.length > 0) {
      const rest = buf.join(" ");
      // A trailing fragment is a sentence when it is long enough to be prose.
      if (buf.length >= 4 || /[.!?]["')\]]*$/.test(rest)) push(rest);
    }
  }
  return out;

  // List markers ("1.") and bare numbers are not sentences.
  function push(sentence: string) {
    if (/\p{L}/u.test(sentence)) out.push(sentence);
  }
}

/** Words of a sentence that carry a letter or digit (the editor's count rule). */
export function proseWords(text: string): string[] {
  return text.split(/\s+/g).filter((w) => /[\p{L}\p{N}]/u.test(w));
}

/**
 * Syllables by the usual vowel-group heuristic: silent "-e" and "-es"
 * endings dropped (not "-ted" / "-ded"), a leading "y" is a consonant,
 * never fewer than one. Within a syllable or so for ordinary English;
 * a bare number counts as one.
 */
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return /\d/.test(word) ? 1 : 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|[^td]ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Flesch-Kincaid grade, one decimal, never below 0. */
export function fleschKincaidGrade(words: number, sentences: number, syllables: number): number {
  if (words <= 0 || sentences <= 0) return 0;
  const grade = 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59;
  return Math.max(0, Math.round(grade * 10) / 10);
}

const BE_FORMS = new Set(["am", "is", "are", "was", "were", "be", "been", "being"]);
const SKIPPABLE = new Set(["not", "also", "then", "being", "still", "already", "never", "often", "always", "now", "all", "both", "either", "well"]);
const NOT_PARTICIPLES = new Set(["need", "indeed", "hundred", "thousand", "unprecedented", "sacred", "naked", "wicked", "rugged", "ragged", "wretched", "beloved", "hatred", "shed", "bed", "red", "wed", "fed", "led", "sled", "speed", "seed", "feed", "weed", "exceed", "proceed", "succeed", "embed", "shred", "sped", "bled", "fled", "bred", "tred"]);
const IRREGULAR_PARTICIPLES = new Set([
  "given", "taken", "made", "done", "built", "held", "kept", "left", "met", "set", "put", "shown", "known", "written", "seen", "won",
  "run", "found", "brought", "bought", "thought", "sent", "spent", "paid", "said", "told", "sold", "led", "read", "cut", "lost", "meant",
  "dealt", "felt", "chosen", "driven", "grown", "drawn", "thrown", "begun", "proven", "understood", "hit", "split", "spread", "let",
  "laid", "lit", "bound", "fed", "bred", "sought", "taught", "caught", "fought", "struck", "stuck", "sworn", "worn", "torn", "born",
  "borne", "hidden", "forgotten", "gotten", "frozen", "broken", "spoken", "stolen", "woven", "risen", "fallen", "eaten", "beaten",
  "bitten", "forbidden", "overseen", "undertaken", "withheld", "upheld", "overcome", "rebuilt", "reset", "redone", "retaken", "overrun",
  "withdrawn", "shut", "bent", "lent", "spun", "swung", "hung", "slid", "stung", "sunk", "shrunk", "sung", "rung", "wrung", "fit",
]);

function isPastParticiple(token: string): boolean {
  const t = token.replace(/[^a-z]/g, "");
  if (!t) return false;
  if (IRREGULAR_PARTICIPLES.has(t)) return true;
  if (NOT_PARTICIPLES.has(t)) return false;
  return t.length >= 5 && t.endsWith("ed");
}

/**
 * Passive voice by shape: a form of "to be", up to two adverbs, then a
 * past participle ("is managed", "were not fully tested", "has been
 * built"). Adjectives that look like participles ("is experienced") are
 * counted too, so the share is approximate and judged against a
 * tolerant threshold.
 */
export function isPassiveSentence(sentence: string): boolean {
  const tokens = sentence.toLowerCase().replace(/[^a-z'\s-]/g, " ").split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length - 1; i++) {
    if (!BE_FORMS.has(tokens[i]!)) continue;
    let j = i + 1;
    let skipped = 0;
    while (j < tokens.length && skipped < 2 && (SKIPPABLE.has(tokens[j]!) || /ly$/.test(tokens[j]!))) {
      j++;
      skipped++;
    }
    if (j < tokens.length && isPastParticiple(tokens[j]!)) return true;
  }
  return false;
}

export type ToneFlagKind = "marketing" | "passive" | "reading_level";
export type ToneFlag = { kind: ToneFlagKind; severity: "high" | "medium"; summary: string };

export type ToneReport = {
  /** Prose words judged (headings and labels excluded). */
  words: number;
  sentences: number;
  syllables: number;
  /** Average words per sentence, one decimal. */
  avgSentenceWords: number;
  /** Flesch-Kincaid grade; null while the text is too short. */
  gradeLevel: number | null;
  passiveSentences: number;
  /** Share of sentences in the passive voice; null with too few sentences. */
  passiveRate: number | null;
  /** Up to three passive sentences, trimmed, for the panel and the hint. */
  passiveExamples: string[];
  marketing: MarketingHit[];
  flags: ToneFlag[];
  /** True below `minWords`: the counts are there but nothing is judged. */
  tooShort: boolean;
};

function excerpt(sentence: string, max = 140): string {
  const s = sentence.trim();
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

export function checkTone(text: string): ToneReport {
  const sentences = splitSentences(text);
  let words = 0;
  let syllables = 0;
  let passiveSentences = 0;
  const passiveExamples: string[] = [];
  for (const s of sentences) {
    const ws = proseWords(s);
    words += ws.length;
    for (const w of ws) syllables += countSyllables(w);
    if (isPassiveSentence(s)) {
      passiveSentences++;
      if (passiveExamples.length < 3) passiveExamples.push(excerpt(s));
    }
  }
  const marketing = findMarketingPhrases(text);
  const tooShort = words < TONE_THRESHOLDS.minWords;
  const gradeLevel = tooShort ? null : fleschKincaidGrade(words, sentences.length, syllables);
  const passiveRate =
    !tooShort && sentences.length >= TONE_THRESHOLDS.minSentencesForPassive
      ? Math.round((passiveSentences / sentences.length) * 100) / 100
      : null;
  const avgSentenceWords = sentences.length > 0 ? Math.round((words / sentences.length) * 10) / 10 : 0;

  const flags: ToneFlag[] = [];
  if (marketing.length > 0) {
    const total = marketing.reduce((n, m) => n + m.count, 0);
    flags.push({
      kind: "marketing",
      severity: total >= 3 ? "high" : "medium",
      summary: `${total} marketing phrase${total === 1 ? "" : "s"} without evidence`,
    });
  }
  if (passiveRate !== null && passiveRate > TONE_THRESHOLDS.passiveRateMax) {
    flags.push({
      kind: "passive",
      severity: passiveRate >= TONE_THRESHOLDS.passiveRateMax * 2 ? "high" : "medium",
      summary: `${Math.round(passiveRate * 100)}% of sentences are passive (keep it under ${Math.round(TONE_THRESHOLDS.passiveRateMax * 100)}%)`,
    });
  }
  if (gradeLevel !== null && gradeLevel > TONE_THRESHOLDS.gradeMax) {
    flags.push({
      kind: "reading_level",
      severity: gradeLevel >= TONE_THRESHOLDS.gradeMax + 3 ? "high" : "medium",
      summary: `Reads at grade ${Math.round(gradeLevel)} (evaluator standard: grade ${TONE_THRESHOLDS.gradeMax} or below)`,
    });
  }

  return {
    words,
    sentences: sentences.length,
    syllables,
    avgSentenceWords,
    gradeLevel,
    passiveSentences,
    passiveRate,
    passiveExamples,
    marketing,
    flags,
    tooShort,
  };
}

/** "grade 12 · 8% passive · 2 flagged phrases", or what is still unjudged. */
export function toneSummary(r: ToneReport): string {
  const phrases = r.marketing.reduce((n, m) => n + m.count, 0);
  const phraseText = phrases === 0 ? "no marketing phrases" : `${phrases} flagged phrase${phrases === 1 ? "" : "s"}`;
  if (r.tooShort) return `${phraseText} · ${TONE_THRESHOLDS.minWords}+ words to judge reading level`;
  const parts = [`grade ${Math.round(r.gradeLevel ?? 0)}`];
  parts.push(r.passiveRate === null ? `${r.passiveSentences} passive` : `${Math.round(r.passiveRate * 100)}% passive`);
  parts.push(phraseText);
  return parts.join(" · ");
}

/**
 * The guidance Improve mode receives on click-to-fix: what to replace,
 * what to rewrite and the level to reach, never a change of facts.
 * Empty when nothing is flagged.
 */
export function buildToneFixHint(r: ToneReport): string {
  if (r.flags.length === 0) return "";
  const lines = ["Fix the tone of this draft without changing its facts, structure or length:"];
  if (r.marketing.length > 0) {
    const list = r.marketing
      .slice(0, 12)
      .map((m) => `"${m.phrase}" (×${m.count} — ${m.suggestion})`)
      .join(", ");
    lines.push(`- Replace marketing language with specific, verifiable claims: ${list}.`);
  }
  if (r.flags.some((f) => f.kind === "passive") && r.passiveRate !== null) {
    const ex = r.passiveExamples.length > 0 ? ` For example: ${r.passiveExamples.map((e) => `"${e}"`).join(" / ")}` : "";
    lines.push(
      `- Rewrite passive sentences in the active voice with a named actor (${Math.round(r.passiveRate * 100)}% of sentences are passive; keep it under ${Math.round(TONE_THRESHOLDS.passiveRateMax * 100)}%).${ex}`,
    );
  }
  if (r.flags.some((f) => f.kind === "reading_level") && r.gradeLevel !== null) {
    lines.push(
      `- Bring the reading level down from grade ${Math.round(r.gradeLevel)} to grade ${TONE_THRESHOLDS.gradeMax} or below: shorter sentences (now ${Math.round(r.avgSentenceWords)} words on average), plainer words, one idea per sentence.`,
    );
  }
  const hint = lines.join("\n");
  return hint.length <= TONE_FIX_HINT_MAX ? hint : `${hint.slice(0, TONE_FIX_HINT_MAX - 1).trimEnd()}…`;
}
