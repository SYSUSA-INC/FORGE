/**
 * BL-AIX Phase 1d — concrete claims that carry no citation at all.
 *
 * The citation verifier checks sentences that cite a source. A sentence
 * that states a hard figure and cites nothing ("We have migrated 140
 * applications since 2019") slipped through: no marker, no
 * [NEEDS CITATION], nothing for the author to check. This pass flags
 * such sentences, deterministically and without a model call.
 *
 * A hard figure is money, a percentage, a year, a count of 10 or more, a
 * contract-number-shaped token or a named certification. A figure the
 * drafter was given (the solicitation, the proposal setup, the section's
 * own text) needs no citation. Bracketed text and requirement numbers
 * (L.5.2.1) are ignored. Promises ("we will…", "we propose…") are
 * commitments, not facts, so they are skipped. The pass leans towards
 * flagging too little rather than too much. Pure; unit-tested.
 */
import { NEEDS_CITATION_MARKER } from "@/lib/citations";

const SOURCE_OR_FLAG_RE = /\[S\d{1,2}\]|\[NEEDS CITATION\]/i;
const COMMITMENT_RE = /\b(will|shall|would|propose[sd]?|plan to|intend to|commits? to)\b/i;

/** The hard figures in a text, normalised so the same figure matches across texts. */
export function factTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  let rest = text.replace(/\[[^\]]*\]/g, " ");

  const take = (re: RegExp, norm: (m: string) => string) => {
    rest = rest.replace(re, (m) => {
      tokens.add(norm(m));
      return " ";
    });
  };
  take(/\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:[kmb]\b|million|billion|thousand))?/gi, (m) => `$:${m.replace(/[\s,$]/g, "").toLowerCase()}`);
  take(/\b\d+(?:\.\d+)?\s?(?:%|percent\b)/gi, (m) => `%:${parseFloat(m)}`);
  take(/\bISO\s?\d{4,5}(?::\d{4})?\b|\bCMMI(?:-[A-Z]+)?\s?(?:ML|Level)\s?\d\b|\bSOC\s?[12]\b/gi, (m) => `c:${m.replace(/\s/g, "").toUpperCase()}`);
  take(/\b(?=[A-Z0-9-]*\d)[A-Z0-9]{2,}(?:-[A-Z0-9]+){2,}\b/g, (m) => `k:${m}`);
  // Requirement and paragraph numbers are references, not claims.
  rest = rest.replace(/\b[A-Z]{1,3}(?:\.\d+)+\b|\b\d+(?:\.\d+){2,}\b/g, " ");
  take(/\b(?:19|20)\d{2}\b/g, (m) => `y:${m}`);
  take(/\b\d{1,3}(?:,\d{3})+\b|\b\d{2,}\b(?![\/x]\d)/g, (m) => `n:${m.replace(/,/g, "")}`);
  return tokens;
}

/**
 * Append [NEEDS CITATION] to every sentence that states a hard figure the
 * drafter was not given and cites nothing. `knownText` is what the drafter
 * was handed as fact.
 */
export function flagUncitedClaims(text: string, knownText: string): { text: string; flagged: number } {
  const known = factTokens(knownText);
  let flagged = 0;
  const parts = text.split(/((?<=[.!?])[ \t]+|\n+)/);
  const out = parts.map((part, i) => {
    if (i % 2 === 1 || !part.trim()) return part;
    if (SOURCE_OR_FLAG_RE.test(part) || COMMITMENT_RE.test(part)) return part;
    const unknown = [...factTokens(part)].some((t) => !known.has(t));
    if (!unknown) return part;
    flagged += 1;
    return `${part.trimEnd()} ${NEEDS_CITATION_MARKER}`;
  });
  return { text: out.join(""), flagged };
}
