/**
 * BL-AIX Phase 2a — where each extracted requirement sits in its
 * document, and whether the document really says it.
 *
 * The sweep asks the model to quote each clause word for word. This
 * module looks for that quote in the extracted text:
 *
 *   - "exact": the whole requirement is in the document (ignoring case,
 *     punctuation, spacing, hyphens and line breaks);
 *   - "partial": only its opening or closing words are, so the model
 *     trimmed or reworded part of it;
 *   - "none": it cannot be found, so it is paraphrased, merged from two
 *     clauses or misread — a row a person should check.
 *
 * A located requirement also gets its page (PDFs), its part of the
 * document (Section C, Attachment J-1) and its numbered paragraph.
 *
 * Pure: no DB, unit-tested.
 */
import type { SolicitationRequirement } from "@/db/schema";
import { paragraphAt, paragraphMarks, segmentAt, segmentSolicitation, type Segment } from "@/lib/solicitation-segments";

/**
 * A requirement's place in the extracted text of its own document (the
 * parent's, or the companion's named by sourceDocId). Stored as an
 * optional `source` on each entry of the extracted_requirements JSON.
 * quote: the whole clause was found word for word, only its opening or
 * closing words, or nothing (paraphrased or misread: check it).
 */
export type RequirementSource = {
  quote: "exact" | "partial" | "none";
  /** Character offset in the document's extracted text. */
  at?: number;
  /** 1-based PDF page. */
  page?: number;
  /** UCF section letter ("C") or attachment ("Attachment J-1"). */
  section?: string;
  /** Numbered paragraph as written ("C.3.2", "3.2.1"). */
  paragraph?: string;
};

/** A stored requirement that may carry its provenance (parsed since Phase 2a). */
export type SourcedRequirement = SolicitationRequirement & { source?: RequirementSource };

export type SourceIndex = {
  /** The source's letters and digits only, lower-cased. */
  norm: string;
  /** For each character of `norm`, its offset in the source text. */
  map: number[];
};

const WORD = /[\p{L}\p{N}]/u;

/**
 * Keep only letters and digits, lower-cased, and remember where each
 * came from. Spacing, punctuation, hyphens and line breaks all drop out,
 * so "help-desk" matches "help desk" and a word hyphenated across a line
 * break ("re-\nquirement") matches it unbroken.
 */
export function buildSourceIndex(raw: string): SourceIndex {
  const norm: string[] = [];
  const map: number[] = [];
  const text = raw ?? "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (!WORD.test(ch)) continue;
    for (const c of ch.toLowerCase()) {
      norm.push(c);
      map.push(i);
    }
  }
  return { norm: norm.join(""), map };
}

export function normalizeForMatch(text: string): string {
  return buildSourceIndex(text).norm;
}

/** Characters at each end that must match for a "partial" quote. */
const PARTIAL_CHARS = 40;
const MIN_QUOTE_CHARS = 12;

export function locateQuote(index: SourceIndex, text: string): { quote: RequirementSource["quote"]; at?: number } {
  const q = normalizeForMatch(text);
  if (q.length < MIN_QUOTE_CHARS) return { quote: "none" };
  const exact = index.norm.indexOf(q);
  if (exact >= 0) return { quote: "exact", at: index.map[exact] };
  if (q.length > PARTIAL_CHARS * 1.5) {
    const head = index.norm.indexOf(q.slice(0, PARTIAL_CHARS));
    if (head >= 0) return { quote: "partial", at: index.map[head] };
    const tail = index.norm.indexOf(q.slice(-PARTIAL_CHARS));
    if (tail >= 0) return { quote: "partial", at: index.map[tail] };
  }
  return { quote: "none" };
}

/**
 * Character offset of each page's first character in text extracted as
 * "\n\n" + page1 + "\n\n" + page2 … and then trimmed at the start by
 * `leadingTrim` characters (how pdf-parse builds its text).
 */
export function pageStartsFromLengths(lengths: number[], leadingTrim: number): number[] {
  const out: number[] = [];
  let at = 0;
  for (const len of lengths) {
    at += 2;
    out.push(Math.max(0, at - leadingTrim));
    at += len;
  }
  return out;
}

/** 1-based page holding `at`, or undefined without page starts. */
export function pageAt(pageStarts: number[] | undefined, at: number): number | undefined {
  if (!pageStarts || pageStarts.length === 0) return undefined;
  let lo = 0;
  let hi = pageStarts.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pageStarts[mid]! <= at) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found + 1;
}

export type QuoteCounts = { exact: number; partial: number; none: number };

/**
 * Attach a `source` to every requirement located in `rawText`. Existing
 * fields are kept; a requirement from another document (`sourceDocId`
 * set) is left alone, since its offsets belong to that document.
 */
export function attachProvenance<T extends SolicitationRequirement>(
  rawText: string,
  requirements: T[],
  options: { pageStarts?: number[]; segments?: Segment[] } = {},
): { requirements: (T & { source?: RequirementSource })[]; counts: QuoteCounts } {
  const index = buildSourceIndex(rawText);
  const segments = options.segments ?? segmentSolicitation(rawText);
  const marks = paragraphMarks(rawText);
  const counts: QuoteCounts = { exact: 0, partial: 0, none: 0 };
  const out = requirements.map((r): T & { source?: RequirementSource } => {
    if (r.sourceDocId) return r;
    const found = locateQuote(index, r.text);
    counts[found.quote] += 1;
    if (found.at === undefined) return { ...r, source: { quote: found.quote } };
    const segment = segmentAt(segments, found.at);
    const source: RequirementSource = { quote: found.quote, at: found.at };
    const page = pageAt(options.pageStarts, found.at);
    if (page !== undefined) source.page = page;
    if (segment && segment.kind !== "front") source.section = segment.key;
    const paragraph = paragraphAt(marks, found.at, segment);
    if (paragraph) source.paragraph = paragraph;
    return { ...r, source };
  });
  return { requirements: out, counts };
}

/** "§C · p. 42 · C.3.2" for a requirement's located source, or "" when none. */
export function describeSource(source: RequirementSource | undefined): string {
  if (!source || source.at === undefined) return "";
  const parts = [
    source.section ? (source.section.length === 1 ? `§${source.section}` : source.section) : "",
    source.page ? `p. ${source.page}` : "",
    source.paragraph ?? "",
  ];
  return parts.filter(Boolean).join(" · ");
}
