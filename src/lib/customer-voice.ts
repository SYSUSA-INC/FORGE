/**
 * BL-FB-GEN-VOC — voice of the customer, pure parts.
 *
 * Evaluators respond to hearing their own words. This module reads the
 * agency's own language out of the solicitation — the evaluation
 * language of Section M, the recurring operative phrases of the
 * requirements, the mission words of the opportunity description — and
 * turns it into a short list of phrases the drafter is asked to echo
 * where a paragraph is about the same thing. `phraseCoverage` tells the
 * research rail which of them a draft already uses. No model call;
 * unit-tested.
 */

export type CustomerPhraseSource = "evaluation" | "requirement" | "mission";

export type CustomerPhrase = {
  /** Lower-cased, as it appears in the source. */
  phrase: string;
  /** Source weight × occurrences; higher first. */
  weight: number;
  /** Where it mostly comes from. */
  source: CustomerPhraseSource;
  /** One sentence it was read from, for the rail's tooltip. */
  sample: string;
};

export type CustomerVoiceInput = {
  sectionMSummary?: string | null;
  sectionLSummary?: string | null;
  requirements?: readonly { text: string }[] | null;
  rawText?: string | null;
  description?: string | null;
};

const SOURCE_WEIGHT: Record<CustomerPhraseSource, number> = { evaluation: 3, mission: 2, requirement: 1 };

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "by", "as", "at", "from", "into",
  "that", "this", "these", "those", "is", "are", "be", "been", "being", "was", "were", "it", "its",
  "shall", "should", "must", "will", "may", "can", "would", "could", "not", "no", "any", "all", "each",
  "such", "than", "then", "there", "their", "they", "them", "we", "our", "us", "you", "your", "he",
  "she", "his", "her", "which", "who", "whom", "what", "when", "where", "how", "if", "but", "so",
  "per", "via", "upon", "within", "under", "over", "between", "through", "during", "after", "before",
  "other", "also", "including", "include", "includes", "included", "provide", "provides", "provided",
  "providing", "offeror", "offerors", "offeror's", "contractor", "contractor's", "contractors",
  "government", "government's", "agency", "proposal", "proposals", "section", "sections", "page",
  "pages", "volume", "volumes", "required", "requirement", "requirements", "describe", "described",
  "description", "following", "below", "above", "etc", "e.g", "i.e", "respectively",
]);

/** Phrases that say nothing about THIS customer. */
const GENERIC = new Set([
  "best value", "technical approach", "management approach", "past performance", "key personnel",
  "period of performance", "place of performance", "statement of work", "performance work statement",
  "task order", "contracting officer", "quality assurance", "quality control", "subject matter",
  "subject matter experts", "lessons learned", "point of contact", "due date", "evaluation factors",
  "evaluation criteria", "technical proposal", "price proposal", "cost proposal", "small business",
  "firm fixed price", "time and materials", "labor categories", "level of effort",
]);

const EVALUATION_CUE = /\b(evaluat|assess|basis for award|best value|trade-?off|technically acceptable|will be considered|demonstrat|strength|weakness|deficienc|rated|rating|confidence)/i;

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9'&/-]*/g) ?? []).map((t) => t.replace(/^[-']+|[-']+$/g, "")).filter(Boolean);
}

function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

/** Comparison key: stemmed tokens joined by spaces. */
export function phraseKey(phrase: string): string {
  return tokenize(phrase).map(stem).join(" ");
}

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.;:!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20);
}

function candidatePhrases(sentence: string): string[] {
  const tokens = tokenize(sentence);
  const out: string[] = [];
  for (const n of [2, 3]) {
    for (let i = 0; i + n <= tokens.length; i++) {
      const gram = tokens.slice(i, i + n);
      if (STOPWORDS.has(gram[0]!) || STOPWORDS.has(gram[n - 1]!)) continue;
      if (gram.some((t) => /^\d/.test(t))) continue;
      if (!gram.some((t) => t.length >= 4)) continue;
      const phrase = gram.join(" ");
      if (GENERIC.has(phrase)) continue;
      out.push(phrase);
    }
  }
  return out;
}

type Acc = { phrase: string; weight: number; sample: string; bySource: Record<CustomerPhraseSource, number> };

/**
 * The customer's phrases, strongest first. Section M (and evaluation
 * sentences found in the full text) weigh three times a requirement
 * clause; the mission statement twice. A phrase must be worth at least
 * one evaluation mention or two requirement mentions to make the list,
 * and a shorter phrase is dropped when a longer one that contains it
 * carries the same weight.
 */
export function extractCustomerVoice(input: CustomerVoiceInput, options: { max?: number } = {}): CustomerPhrase[] {
  const max = options.max ?? 24;
  const acc = new Map<string, Acc>();
  const add = (sentence: string, source: CustomerPhraseSource) => {
    const seen = new Set<string>();
    for (const phrase of candidatePhrases(sentence)) {
      const key = phraseKey(phrase);
      if (seen.has(key)) continue;
      seen.add(key);
      const cur = acc.get(key) ?? { phrase, weight: 0, sample: sentence.slice(0, 240), bySource: { evaluation: 0, requirement: 0, mission: 0 } };
      cur.weight += SOURCE_WEIGHT[source];
      cur.bySource[source] += SOURCE_WEIGHT[source];
      if (source === "evaluation" && cur.bySource.evaluation === SOURCE_WEIGHT.evaluation) cur.sample = sentence.slice(0, 240);
      acc.set(key, cur);
    }
  };

  for (const s of sentences(input.sectionMSummary ?? "")) add(s, "evaluation");
  for (const s of sentences((input.rawText ?? "").slice(0, 200_000))) if (EVALUATION_CUE.test(s)) add(s, "evaluation");
  for (const s of sentences(input.sectionLSummary ?? "")) add(s, "requirement");
  for (const r of (input.requirements ?? []).slice(0, 400)) for (const s of sentences(r.text)) add(s, "requirement");
  for (const s of sentences(input.description ?? "")) add(s, "mission");

  const kept = [...acc.entries()]
    .filter(([, a]) => a.weight >= 2)
    .map(([key, a]) => {
      const source = (Object.keys(a.bySource) as CustomerPhraseSource[]).sort((x, y) => a.bySource[y] - a.bySource[x])[0]!;
      return { key, phrase: a.phrase, weight: a.weight, source, sample: a.sample };
    })
    .sort((x, y) => y.weight - x.weight || y.key.length - x.key.length || x.key.localeCompare(y.key));

  // Drop a phrase contained in a longer kept phrase of the same weight.
  const out: CustomerPhrase[] = [];
  const keys: { key: string; weight: number }[] = [];
  for (const k of kept) {
    if (keys.some((o) => o.weight === k.weight && o.key !== k.key && ` ${o.key} `.includes(` ${k.key} `))) continue;
    keys.push({ key: k.key, weight: k.weight });
    out.push({ phrase: k.phrase, weight: k.weight, source: k.source, sample: k.sample });
    if (out.length >= max) break;
  }
  return out;
}

/** Which phrases the draft already uses (stemmed match), and which it does not. */
export function phraseCoverage<T extends { phrase: string }>(
  draft: string,
  phrases: readonly T[],
): { echoed: T[]; missing: T[] } {
  const hay = ` ${tokenize(draft).map(stem).join(" ")} `;
  const echoed: T[] = [];
  const missing: T[] = [];
  for (const p of phrases) {
    const key = phraseKey(p.phrase);
    (key && hay.includes(` ${key} `) ? echoed : missing).push(p);
  }
  return { echoed, missing };
}

/** The list the drafter sees. */
export function voiceGuidance(phrases: readonly CustomerPhrase[], max = 12): { phrase: string; source: CustomerPhraseSource }[] {
  return phrases.slice(0, max).map((p) => ({ phrase: p.phrase, source: p.source }));
}
