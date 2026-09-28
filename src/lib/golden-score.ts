/**
 * BL-AIP-5b — scoring a fresh draft against the text that won.
 *
 * The golden eval re-drafts sections of won proposals from the
 * solicitation context alone and asks: how close did the drafter come
 * to what the team actually submitted and won with? A model-graded
 * judge would cost a second call per case and drift with its own
 * prompt; these measures are deterministic, cheap and stable across
 * prompt versions, which is what makes runs comparable:
 *
 *   termCoverage    share of the winning text's most frequent
 *                   distinctive terms the draft also uses (0..1)
 *   lengthFit       how close the draft's length is to the winner's
 *   specificity     density of numbers and named things relative to
 *                   the winner's (capped at 1)
 *   placeholderRate [BRACKET] placeholders per 100 draft words — a
 *                   draft that punts to the author scores lower
 *   themeCoverage   share of the proposal's win themes the draft
 *                   reinforces lexically (null without themes)
 *
 * score = 0.45·termCoverage + 0.20·lengthFit + 0.20·specificity
 *       + 0.15·(1 − min(1, placeholderRate / 2)).
 * Pure; unit-tested.
 */
import { coverageScore, distinctiveTerms } from "@/lib/research-signals";

export const GOLDEN_TOP_TERMS = 40;

export type GoldenScore = {
  score: number;
  termCoverage: number;
  lengthFit: number;
  specificity: number;
  placeholderRate: number;
  themeCoverage: number | null;
  goldenWords: number;
  draftWords: number;
};

export function countWords(text: string): number {
  return text.split(/\s+/g).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** The winning text's most frequent distinctive terms, most frequent first. */
export function topTerms(text: string, max = GOLDEN_TOP_TERMS): string[] {
  const allowed = new Set(distinctiveTerms(text));
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    const t = raw.replace(/s$/, "");
    if (!allowed.has(t)) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([t]) => t);
}

/** Numbers, currency, percentages and capitalised names per 100 words. */
export function specificityDensity(text: string): number {
  const words = countWords(text);
  if (words === 0) return 0;
  const numbers = (text.match(/(?:\$\s?)?\d[\d,.]*(?:\s?%|\b)/g) ?? []).length;
  const capitalised = (text.match(/(?<![.!?]\s|^)\b[A-Z][a-z]{2,}\b/gm) ?? []).length;
  return ((numbers + capitalised) / words) * 100;
}

/** [BRACKET] placeholders the drafter left for the author, per 100 words. */
export function placeholderRate(text: string): number {
  const words = countWords(text);
  if (words === 0) return 0;
  const count = (text.match(/\[[A-Z][^\]\n]{0,80}\]/g) ?? []).filter(
    (m) => !/^\[S\d+\]$/.test(m) && !/^\[[A-Z]\.?\d/.test(m),
  ).length;
  return (count / words) * 100;
}

export function scoreDraftAgainstGolden(input: {
  draft: string;
  golden: string;
  themes?: { title: string; statement: string }[];
}): GoldenScore {
  const goldenWords = countWords(input.golden);
  const draftWords = countWords(input.draft);

  const terms = topTerms(input.golden);
  const haystack = input.draft.toLowerCase().replace(/s\b/g, "");
  const termCoverage =
    terms.length === 0 ? 0 : terms.filter((t) => haystack.includes(t)).length / terms.length;

  const lengthFit =
    goldenWords === 0 || draftWords === 0
      ? 0
      : Math.min(draftWords / goldenWords, goldenWords / draftWords);

  const goldenDensity = specificityDensity(input.golden);
  const draftDensity = specificityDensity(input.draft);
  const specificity =
    goldenDensity <= 0 ? (draftDensity > 0 ? 1 : 0) : Math.min(1, draftDensity / goldenDensity);

  const placeholders = placeholderRate(input.draft);
  const placeholderPenalty = Math.min(1, placeholders / 2);

  const themes = (input.themes ?? []).filter((t) => t.title || t.statement);
  const themeCoverage =
    themes.length === 0
      ? null
      : themes.reduce((a, t) => a + coverageScore(input.draft, `${t.title} ${t.statement}`), 0) /
        themes.length;

  const score =
    0.45 * termCoverage + 0.2 * lengthFit + 0.2 * specificity + 0.15 * (1 - placeholderPenalty);

  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return {
    score: r3(score),
    termCoverage: r3(termCoverage),
    lengthFit: r3(lengthFit),
    specificity: r3(specificity),
    placeholderRate: r3(placeholders),
    themeCoverage: themeCoverage === null ? null : r3(themeCoverage),
    goldenWords,
    draftWords,
  };
}

export function meanScore(results: { score: number }[]): number {
  if (results.length === 0) return 0;
  return Math.round((results.reduce((a, r) => a + r.score, 0) / results.length) * 1000) / 1000;
}
