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
