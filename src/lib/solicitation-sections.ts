/**
 * BL-AIX Phase 0 — find Sections L and M wherever they sit.
 *
 * Under the Uniform Contract Format, Section L (instructions to
 * offerors) and Section M (evaluation factors) are Part IV, at the END
 * of the RFP. The front-matter pass used to read only the first 80k
 * characters, assuming they covered L and M; on a long RFP they never
 * did. This module locates each section's real start and builds the
 * excerpt the front-matter and review prompts read: the beginning of
 * the document plus the located Section L and Section M.
 *
 * Pure: no DB, unit-tested.
 */

export type UcfPart = "L" | "M";

const HEADINGS: Record<UcfPart, RegExp> = {
  L: /\bsection\s+l\b|instructions,?\s+conditions,?\s+and\s+notices\s+to\s+(?:offerors|bidders|quoters|respondents)/gi,
  M: /\bsection\s+m\b|evaluation\s+factors\s+for\s+award/gi,
};

/** Words that fill the body of each section; counted to tell a heading from a passing mention. */
const BODY_TERMS: Record<UcfPart, RegExp> = {
  L: /\b(?:offerors?|proposals?|volumes?|pages?|font|margins?|submit\w*|format\w*|copies|tabs?)\b/gi,
  M: /\b(?:evaluat\w*|factors?|subfactors?|ratings?|adjectival|trade-?off|best\s+value|technically\s+acceptable|importance|weight\w*)\b/gi,
};

/** How many body words in the following window make a match a real section start. */
const MIN_BODY_TERMS: Record<UcfPart, number> = { L: 8, M: 6 };
const BODY_WINDOW = 4_000;
const TOC_WINDOW = 600;

function count(re: RegExp, text: string): number {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(text) !== null) n += 1;
  return n;
}

/** A table of contents lists several section headings close together. */
function looksLikeContents(text: string, at: number): boolean {
  const near = text.slice(at, at + TOC_WINDOW);
  return count(/\bsection\s+[a-m]\b/gi, near) >= 3;
}

/** The match sits at the start of a line (a heading), not mid-sentence. */
function atLineStart(text: string, at: number): boolean {
  const lineStart = text.lastIndexOf("\n", at - 1) + 1;
  return text.slice(lineStart, at).replace(/part\s+[iv]+\b|[-–—:.\s]/gi, "").length === 0;
}

/**
 * Character offset where Section L or M begins, or null when the
 * document doesn't follow that structure. The first match that isn't a
 * contents line and is followed by enough section body wins, preferring
 * one at the start of a line (a heading), so running page headers and
 * later cross-references ("as stated in Section L") don't move it.
 */
export function locateSection(rawText: string, part: UcfPart): number | null {
  const text = rawText ?? "";
  const heading = HEADINGS[part];
  heading.lastIndex = 0;
  let firstQualifying: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = heading.exec(text)) !== null) {
    const at = m.index;
    if (looksLikeContents(text, at)) continue;
    if (count(BODY_TERMS[part], text.slice(at, at + BODY_WINDOW)) < MIN_BODY_TERMS[part]) continue;
    if (atLineStart(text, at)) return at;
    firstQualifying ??= at;
  }
  // PDF text sometimes loses the line break before a heading.
  return firstQualifying;
}

export type FrontPassExcerpt = {
  text: string;
  /** Where Section L / M were found (character offsets), when they were. */
  sectionLAt: number | null;
  sectionMAt: number | null;
  /** True when the excerpt leaves part of the document out. */
  partial: boolean;
};

const HEAD_CHARS = 40_000;
const L_CHARS = 26_000;
const M_CHARS = 20_000;

/**
 * What a front-matter style prompt reads from a solicitation: the whole
 * text when it fits in `budget`; otherwise the beginning (cover page,
 * Sections A–C) plus the located Sections L and M, each labelled with
 * where it came from. When neither section can be located the first
 * `budget` characters are used, as before.
 */
export function frontPassExcerpt(rawText: string, budget = 90_000): FrontPassExcerpt {
  const text = rawText ?? "";
  if (text.length <= budget) return { text, sectionLAt: null, sectionMAt: null, partial: false };
  const lAt = locateSection(text, "L");
  const mAt = locateSection(text, "M");
  if (lAt === null && mAt === null) {
    return { text: text.slice(0, budget), sectionLAt: null, sectionMAt: null, partial: true };
  }

  const parts: string[] = [`[Beginning of the document — characters 0 to ${HEAD_CHARS.toLocaleString("en-US")}]`, text.slice(0, HEAD_CHARS)];
  const take = (label: string, at: number | null, size: number, stopAt: number | null) => {
    if (at === null) return;
    // A section that starts inside the beginning continues from where it stops.
    const start = Math.max(at, HEAD_CHARS);
    const end = stopAt !== null && stopAt > at ? Math.min(at + size, stopAt) : at + size;
    if (end <= start) return;
    parts.push(`[${label} — from character ${start.toLocaleString("en-US")}]`, text.slice(start, end));
  };
  take("Section L, instructions to offerors", lAt, L_CHARS, mAt);
  take("Section M, evaluation factors", mAt, M_CHARS, null);
  return { text: parts.join("\n\n"), sectionLAt: lAt, sectionMAt: mAt, partial: true };
}
