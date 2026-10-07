/**
 * BL-AIP-4 — ranking adjustments layered on cosine similarity for Brain
 * retrieval. Similarity says "this text is about the same thing"; these
 * say "and this one is worth reusing": it came from a win, it is the
 * kind of document a proposal is built from, it is recent, and (for
 * curated entries) a reviewer approved it and it scored well. Pure;
 * unit-tested. Magnitudes are small on purpose — they break ties and
 * nudge, they never override a clearly better semantic match.
 */

export type RankInput = {
  outcomeLabel?: string | null;
  kind?: string | null;
  updatedAt?: Date | string | null;
  /** 0..1 heuristic quality score (curated entries only). */
  qualityScore?: number | null;
  /** Reviewer-approved knowledge entry (vs. a raw corpus chunk). */
  curated?: boolean;
};

/** Won content rises, lost content is slightly demoted. */
export function outcomeBoost(label: string | null | undefined): number {
  switch (label) {
    case "won":
      return 0.1;
    case "lost":
      return -0.05;
    default:
      return 0;
  }
}

/** Proposals and performance evidence are what proposals reuse. */
export function kindBoost(kind: string | null | undefined): number {
  switch (kind) {
    case "proposal":
      return 0.03;
    case "cpars":
    case "past_performance":
      return 0.02;
    case "debrief":
    case "capability":
    case "capability_brief":
      return 0.01;
    default:
      return 0;
  }
}

/** Under a year: +0.03; one to three years: 0; older: −0.03. */
export function recencyBoost(
  updatedAt: Date | string | null | undefined,
  now: Date = new Date(),
): number {
  if (!updatedAt) return 0;
  const t = updatedAt instanceof Date ? updatedAt.getTime() : new Date(updatedAt).getTime();
  if (Number.isNaN(t)) return 0;
  const days = (now.getTime() - t) / 86_400_000;
  if (days <= 365) return 0.03;
  if (days <= 3 * 365) return 0;
  return -0.03;
}

/** Up to +0.05 for a perfect quality score; nothing when unscored. */
export function qualityBoost(score: number | null | undefined): number {
  if (score == null || Number.isNaN(score)) return 0;
  return 0.05 * Math.min(1, Math.max(0, score));
}

export const CURATED_BOOST = 0.05;

export function rankBoost(input: RankInput, now: Date = new Date()): number {
  return (
    outcomeBoost(input.outcomeLabel) +
    kindBoost(input.kind) +
    recencyBoost(input.updatedAt, now) +
    qualityBoost(input.qualityScore) +
    (input.curated ? CURATED_BOOST : 0)
  );
}

// ────────────────────────────────────────────────────────────────────
// BL-AIP-4b — hybrid search: vector ranking + full-text ranking fused
// ────────────────────────────────────────────────────────────────────

/** Standard RRF constant: rank 1 scores 1/61, rank 10 scores 1/70. */
export const RRF_K = 60;

/**
 * BL-AIX Phase 1h-1 — the revision of Brain ranking (the RRF fusion, the
 * boosts and their weights, the candidate limits). Stored on every
 * retrieval eval run so recall can be compared across ranking changes.
 * Bump it whenever any of those change.
 */
export const BRAIN_RETRIEVAL_VERSION = "2026-10-07.1";

/**
 * Reciprocal rank fusion. Each list is ordered best-first; an id's fused
 * score is the sum over the lists it appears in of 1 / (k + rank). Ids
 * that both signals like rise above ids only one signal likes, without
 * needing the two scores to be on the same scale.
 */
export function reciprocalRankFusion(
  lists: string[][],
  k: number = RRF_K,
): Map<string, { score: number; lists: number[] }> {
  const out = new Map<string, { score: number; lists: number[] }>();
  lists.forEach((list, listIndex) => {
    list.forEach((id, i) => {
      const cur = out.get(id) ?? { score: 0, lists: [] };
      cur.score += 1 / (k + i + 1);
      cur.lists.push(listIndex);
      out.set(id, cur);
    });
  });
  return out;
}

/**
 * Scale a fused score to the 0..1 band the UI shows as a percentage:
 * the best possible score (rank 1 in every list) maps to 1.
 */
export function fusedToUnit(score: number, listCount: number, k: number = RRF_K): number {
  const best = listCount / (k + 1);
  return best > 0 ? Math.min(1, score / best) : 0;
}

const LEXICAL_STOPWORDS = new Set([
  "the", "and", "for", "with", "this", "that", "are", "was", "were", "from",
  "into", "they", "their", "have", "has", "had", "but", "not", "you", "your",
  "our", "any", "all", "each", "such", "shall", "will", "may", "include",
  "including", "section", "agency", "naics", "proposal", "rfp", "kind",
  "opportunity", "current", "draft", "title", "set", "aside",
]);

/**
 * Turn free text into a `websearch_to_tsquery` string that ORs its most
 * distinctive terms, so a paragraph-sized query still matches documents
 * that share a few key terms instead of demanding every word.
 */
export function lexicalQueryFromText(text: string, maxTerms = 12): string {
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []) {
    if (LEXICAL_STOPWORDS.has(raw)) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  const terms = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, maxTerms)
    .map(([t]) => t);
  return terms.join(" OR ");
}
