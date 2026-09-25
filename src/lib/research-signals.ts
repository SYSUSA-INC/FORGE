/**
 * BL-AIP-6 — the research-while-you-write rail, pure parts.
 *
 * The rail runs on a debounce while the writer types, so it must be
 * cheap: no model call. Requirement and theme coverage is a lexical
 * check (are the requirement's distinctive terms present in the draft?)
 * that errs toward flagging; the AI health scan remains the authority
 * and its contradictions are surfaced as-is. Pure, tested.
 */

const STOPWORDS = new Set([
  "the", "and", "for", "that", "with", "this", "from", "shall", "should", "must", "will",
  "offeror", "offerors", "contractor", "contractors", "government", "provide", "provides",
  "including", "include", "includes", "all", "any", "each", "such", "into", "within",
  "their", "there", "have", "has", "been", "are", "was", "were", "not", "may", "can",
  "proposal", "proposals", "section", "sections", "volume", "volumes", "page", "pages",
  "required", "requirement", "requirements", "describe", "description", "approach",
  "support", "services", "service", "shall", "which", "when", "where", "than", "then",
  "also", "other", "under", "over", "per", "via", "upon", "about", "between",
]);

/** Distinctive lower-cased terms of a clause (length > 3, not a stopword). */
export function distinctiveTerms(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    const t = raw.replace(/s$/, "");
    if (t.length <= 3 || STOPWORDS.has(t) || STOPWORDS.has(raw)) continue;
    seen.add(t);
  }
  return [...seen];
}

/** Fraction of `clause`'s distinctive terms that appear in `draft`, 0..1. */
export function coverageScore(draft: string, clause: string): number {
  const terms = distinctiveTerms(clause);
  if (terms.length === 0) return 1;
  const haystack = draft.toLowerCase().replace(/s\b/g, "");
  let hit = 0;
  for (const t of terms) if (haystack.includes(t)) hit++;
  return hit / terms.length;
}

export const COVERAGE_THRESHOLD = 0.4;

export type CoverageItem<T> = T & { coverage: number; missingTerms: string[] };

/**
 * Items whose distinctive terms mostly do not appear in the draft yet,
 * least covered first. Capped so the rail stays scannable.
 */
export function itemsNotCovered<T extends { text: string }>(
  draft: string,
  items: T[],
  options: { threshold?: number; max?: number } = {},
): CoverageItem<T>[] {
  const threshold = options.threshold ?? COVERAGE_THRESHOLD;
  const max = options.max ?? 8;
  const haystack = draft.toLowerCase().replace(/s\b/g, "");
  const out: CoverageItem<T>[] = [];
  for (const item of items) {
    const terms = distinctiveTerms(item.text);
    if (terms.length === 0) continue;
    const missing = terms.filter((t) => !haystack.includes(t));
    const coverage = 1 - missing.length / terms.length;
    if (coverage < threshold) out.push({ ...item, coverage, missingTerms: missing.slice(0, 6) });
  }
  return out.sort((a, b) => a.coverage - b.coverage).slice(0, max);
}

/**
 * The paragraph the writer is working in: the first paragraph that
 * differs from the previous text, else the last non-empty one.
 */
export function focusParagraph(previous: string, next: string): string {
  const prev = previous.split(/\n{2,}/g);
  const cur = next.split(/\n{2,}/g);
  for (let i = 0; i < cur.length; i++) {
    if (cur[i] !== prev[i]) {
      const p = cur[i]!.trim();
      if (p) return p;
    }
  }
  for (let i = cur.length - 1; i >= 0; i--) {
    const p = cur[i]!.trim();
    if (p) return p;
  }
  return "";
}

/** Rail refreshes only when the text moved enough to be worth a lookup. */
export function shouldRefresh(previous: string, next: string, minDelta = 40): boolean {
  if (next.trim().length < 80) return false;
  if (previous === next) return false;
  return Math.abs(next.length - previous.length) >= minDelta || focusParagraph(previous, next) !== focusParagraph("", previous);
}
