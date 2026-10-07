/**
 * BL-AIX Phase 1h-1 — scoring the Brain's retrieval against a tenant's
 * own won proposals. Pure; unit-tested.
 *
 * A case is one section of a won, harvested proposal. It is searched the
 * way FORGE searches when drafting that section anew, and a hit counts as
 * relevant when it carries that section's winning text (in the harvested
 * proposal or anything distilled from it). Every case, query and hit
 * belongs to one organization; nothing crosses tenants.
 *
 * Two query modes:
 *   - `drafter` — the drafter's own source query (`draftSourcesQuery`)
 *     with no draft yet: what citation mode retrieves today;
 *   - `requirements` — the section plus the requirements mapped to it:
 *     what a requirement-led query would retrieve. Only cases with mapped
 *     requirements have one.
 */
import { goldenOf, copiesGolden } from "@/lib/golden-holdout";

export type RetrievalMode = "drafter" | "requirements";
export const RETRIEVAL_MODES: RetrievalMode[] = ["drafter", "requirements"];

/** Ranks reported; 8 is about what the drafter takes in citation mode. */
export const RETRIEVAL_KS = [1, 3, 8] as const;

/** A section counts as a case only with at least this much winning text. */
export const RETRIEVAL_MIN_WORDS = 80;
export const RETRIEVAL_MAX_CASES = 20;
/** Mapped requirements put into a requirement-led query. */
export const RETRIEVAL_MAX_REQUIREMENTS = 8;

/** The requirement-led query, or null when no requirement is mapped to the section. */
export function requirementsQuery(input: { sectionTitle: string; sectionKind: string; requirements: string[] }): string | null {
  const reqs = input.requirements.map((r) => r.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, RETRIEVAL_MAX_REQUIREMENTS);
  if (reqs.length === 0) return null;
  return [`Section: ${input.sectionTitle} (${input.sectionKind.replace(/_/g, " ")})`, "Requirements:", ...reqs.map((r) => `- ${r.slice(0, 400)}`)].join("\n");
}

/** 1-based rank of the first hit carrying the section's winning text, or null. */
export function firstRelevantRank(hits: string[], sectionText: string): number | null {
  const golden = goldenOf(sectionText);
  const i = hits.findIndex((h) => copiesGolden(h, golden));
  return i === -1 ? null : i + 1;
}

export type RetrievalCaseResult = {
  proposalId: string;
  proposalTitle: string;
  sectionId: string;
  sectionTitle: string;
  sectionKind: string;
  /** Rank per mode; null when nothing relevant came back; absent when the mode had no query. */
  ranks: Partial<Record<RetrievalMode, number | null>>;
  hitsReturned: Partial<Record<RetrievalMode, number>>;
  error?: string;
};

export type RetrievalModeSummary = {
  cases: number;
  /** Share of cases with a relevant hit at or above rank k. */
  recallAt1: number;
  recallAt3: number;
  recallAt8: number;
  /** Mean reciprocal rank of the first relevant hit (0 when none). */
  mrr: number;
};

export type RetrievalSummary = Partial<Record<RetrievalMode, RetrievalModeSummary>>;

export function summarizeRetrieval(results: RetrievalCaseResult[]): RetrievalSummary {
  const out: RetrievalSummary = {};
  for (const mode of RETRIEVAL_MODES) {
    const ranks = results.filter((r) => !r.error && mode in r.ranks).map((r) => r.ranks[mode] ?? null);
    if (ranks.length === 0) continue;
    const within = (k: number) => ranks.filter((r) => r !== null && r <= k).length / ranks.length;
    out[mode] = {
      cases: ranks.length,
      recallAt1: within(1),
      recallAt3: within(3),
      recallAt8: within(8),
      mrr: ranks.reduce<number>((sum, r) => sum + (r ? 1 / r : 0), 0) / ranks.length,
    };
  }
  return out;
}

/** Cases whose winning text the Brain did not return in the top 8 for a mode. */
export function retrievalMisses(results: RetrievalCaseResult[], mode: RetrievalMode): RetrievalCaseResult[] {
  return results.filter((r) => !r.error && mode in r.ranks && (r.ranks[mode] === null || (r.ranks[mode] ?? 0) > 8));
}
