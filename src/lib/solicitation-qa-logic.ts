/**
 * BL-FB-SOL-QA — contracting-officer Q&A, pure parts.
 *
 * Agencies answer industry questions as a "Questions and Answers"
 * attachment on the SAM.gov notice, inside the notice description, or
 * by email the team pastes in. This module turns that text into
 * question/answer pairs, decides whether an attachment is a Q&A
 * document at all, finds the requirements an answer refines (explicit
 * section references first, then word overlap) and keys each pair so a
 * re-poll never stores the same answer twice. Unit-tested.
 */

export const QA_LIMITS = {
  maxPairs: 300,
  maxQuestionChars: 2_000,
  maxAnswerChars: 6_000,
  /** An attachment larger than this is not downloaded. */
  maxDownloadBytes: 20 * 1024 * 1024,
  /** New attachments read per poll of one notice. */
  maxDownloadsPerPoll: 5,
  /** Notices polled per daily cron tick. */
  maxSolicitationsPerCron: 25,
} as const;

export type QaPair = { ordinal: number; question: string; answer: string };

const Q_MARK =
  /^\s*(?:(?:q(?:uestion)?)\s*(?:#|no\.?)?\s*\d{0,3}\s*[:.)\]\-–—]\s*|(\d{1,3})\s*[.)]\s+)/i;
const A_MARK =
  /^\s*(?:(?:government|govt?\.?|agency|contracting officer|co|cor|ko)\s*(?:response|answer|reply)|a(?:nswer)?|response|reply)\s*(?:#|no\.?)?\s*\d{0,3}\s*[:.)\]\-–—]\s*/i;
/** An answer marker inside a line ("Q: …? A: …"), to split on. */
const INLINE_A = /\s(?=(?:government\s+)?(?:a|answer|response|reply)\s*\d{0,3}\s*[:\-–—]\s)/i;

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Q&A pairs in the common federal formats; unanswered questions are dropped. */
export function parseQaPairs(text: string): QaPair[] {
  const lines: string[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.replace(/\t/g, " ").trimEnd();
    if (Q_MARK.test(line)) {
      const parts = line.split(INLINE_A);
      lines.push(...parts);
    } else {
      lines.push(line);
    }
  }
  const pairs: QaPair[] = [];
  let q: string[] | null = null;
  let a: string[] | null = null;
  const flush = () => {
    const question = clean((q ?? []).join(" ")).slice(0, QA_LIMITS.maxQuestionChars);
    const answer = clean((a ?? []).join(" ")).slice(0, QA_LIMITS.maxAnswerChars);
    if (answer) pairs.push({ ordinal: pairs.length + 1, question, answer });
    q = null;
    a = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) {
      // A blank line ends an answer only when the next content starts a new pair.
      continue;
    }
    const qm = Q_MARK.exec(line);
    if (qm && (a !== null || q === null)) {
      // A bare numbered line counts as a question only when it reads as one.
      const numbered = qm[1] !== undefined;
      const next = lines.slice(i + 1).find((l) => l.trim())?.trim() ?? "";
      if (!numbered || /\?/.test(line) || A_MARK.test(next)) {
        flush();
        q = [line.slice(qm[0].length)];
        continue;
      }
    }
    const am = A_MARK.exec(line);
    if (am && q !== null && a === null) {
      a = [line.slice(am[0].length)];
      continue;
    }
    if (a !== null) a.push(line.trim());
    else if (q !== null) q.push(line.trim());
    if (pairs.length >= QA_LIMITS.maxPairs) break;
  }
  flush();
  // Within one document the same answer is stored once.
  const seen = new Set<string>();
  return pairs
    .filter((p) => {
      const k = qaDedupeKey(p.question, p.answer);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((p, i) => ({ ...p, ordinal: i + 1 }));
}

const QA_FILE = /q\s*(?:&|and|\/|\+)\s*a|question|answer|clarification|rfi\s*response|industry\s*(?:day|question)/i;

/** A Q&A document by its file name, or by holding at least two answered questions. */
export function looksLikeQaDocument(fileName: string, text: string): boolean {
  if (QA_FILE.test(fileName)) return true;
  return parseQaPairs(text).length >= 2;
}

/** FNV-1a over the normalised question and answer; short enough for a unique index. */
export function qaDedupeKey(question: string, answer: string): string {
  const h = (s: string) => {
    let x = 0x811c9dc5;
    for (const ch of s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()) {
      x ^= ch.codePointAt(0)!;
      x = Math.imul(x, 0x01000193) >>> 0;
    }
    return x.toString(16).padStart(8, "0");
  };
  return `${h(question)}${h(answer)}`;
}

const KEYWORD_REF = /\b(section|sec\.?|para(?:graph)?|pws|sow|attachment|att\.?|clause|exhibit|cdrl)\s+([A-Z]{1,3}[-.]?\d+(?:\.\d+)*[a-z]?|\d+(?:\.\d+)+)\b/gi;
const LETTER_REF = /\b([A-Z]{1,2}[-.]\d+(?:\.\d+)*[a-z]?)\b/g;
const KEEP_PREFIX = new Set(["pws", "sow", "attachment", "exhibit", "cdrl"]);

/** "Section L.5.2.1" → "L.5.2.1"; "paragraph 3.2 of the PWS" → "3.2"; "PWS 3.2" → "PWS 3.2"; bare decimals are not refs. */
export function extractRefs(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(KEYWORD_REF)) {
    const prefix = m[1]!.toLowerCase().replace(/\.$/, "");
    const ref = normalizeRef(m[2]!);
    out.add(KEEP_PREFIX.has(prefix) ? `${prefix.toUpperCase()} ${ref}` : ref);
  }
  for (const m of text.matchAll(LETTER_REF)) out.add(normalizeRef(m[1]!));
  return [...out];
}

/** Upper-case, "Section"/"§" prefix dropped, trailing period dropped. */
export function normalizeRef(ref: string): string {
  return ref
    .replace(/^\s*(?:section|sec\.?|§)\s*/i, "")
    .replace(/\.$/, "")
    .trim()
    .toUpperCase();
}

const STOP = new Set(
  "the a an and or of to in for on with by at from as is are be been will shall should may must that this these those it its their our your any all each per not no yes than then into upon under over within without which who whom what when where how also such other same both either".split(" "),
);

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(" ")
      .filter((w) => w.length >= 4 && !STOP.has(w)),
  );
}

export type QaRequirementMatch = { ref: string; text: string; score: number; byRef: boolean };

/**
 * The requirements each pair refines: a requirement whose reference the
 * question or answer names, else one whose content words the pair
 * covers (half of them, three at least). Top three per pair.
 */
export function matchQaToRequirements(
  pairs: readonly QaPair[],
  requirements: readonly { ref: string; text: string }[],
): Map<number, QaRequirementMatch[]> {
  const reqs = requirements.map((r) => ({ ref: r.ref, norm: normalizeRef(r.ref), text: r.text, words: contentWords(r.text) }));
  const out = new Map<number, QaRequirementMatch[]>();
  for (const p of pairs) {
    const joined = `${p.question} ${p.answer}`;
    const refs = new Set(extractRefs(joined).map((r) => r.replace(/^(PWS|SOW|ATTACHMENT|EXHIBIT|CDRL) /, "")));
    const words = contentWords(joined);
    const matches: QaRequirementMatch[] = [];
    for (const r of reqs) {
      const byRef = r.norm !== "" && (refs.has(r.norm) || refs.has(r.norm.replace(/^(PWS|SOW|ATTACHMENT|EXHIBIT|CDRL) /, "")));
      let shared = 0;
      for (const w of r.words) if (words.has(w)) shared++;
      const score = r.words.size > 0 ? shared / r.words.size : 0;
      if (byRef || (shared >= 3 && score >= 0.5)) matches.push({ ref: r.ref, text: r.text, score: byRef ? 1 : score, byRef });
    }
    matches.sort((x, y) => Number(y.byRef) - Number(x.byRef) || y.score - x.score);
    if (matches.length > 0) out.set(p.ordinal, matches.slice(0, 3));
  }
  return out;
}

/** "3 answers · 2 requirements refined", for the panel eyebrow. */
export function describeQa(pairs: number, refs: number): string {
  if (pairs === 0) return "no answers yet";
  return `${pairs} answer${pairs === 1 ? "" : "s"}${refs > 0 ? ` · ${refs} requirement${refs === 1 ? "" : "s"} refined` : ""}`;
}
