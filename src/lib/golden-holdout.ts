/**
 * BL-AIX Phase 1c — keeping the answer out of the golden eval.
 *
 * A golden case re-drafts a section of a won proposal and scores the
 * draft against the text that won. Withholding the saved body was not
 * enough: the drafter's context can carry the answer back in. Its
 * proposal's harvested corpus chunks, the team's tracked-change
 * decisions on it and the review comments on that section all quote the
 * winning text.
 *
 * Two layers hold the case out:
 *   1. Provenance — the drafter never reads data that came from the
 *      case's own proposal (applied where the data is loaded).
 *   2. Content — any remaining snippet that copies the winning text,
 *      wherever it came from (a re-upload, a recompete's reused text), is
 *      dropped. `copiesGolden` decides; this module keeps it pure.
 *
 * `promptLeak` then measures what still got through: the share of the
 * winning text's 8-word runs found anywhere in the final prompt. Some is
 * legitimate (a winner often quotes the requirements it answers); a high
 * figure means the case's score is not trustworthy.
 */
import type { AiEvalCaseResult } from "@/db/schema";
import type { SectionDraftPatternIntel } from "@/lib/ai-prompts";

/** Words per run when comparing text with the winning section. */
export const HOLDOUT_SHINGLE = 8;
/** A snippet sharing at least this share of its runs with the winner is a copy. */
export const HOLDOUT_MAX_OVERLAP = 0.2;
/** Shorter snippets count as copies only when the winner contains them verbatim and they are at least this long. */
const MIN_PHRASE_WORDS = 4;

export type HoldoutReport = {
  /** Retrieved excerpts and phrases dropped because they copied the winning text. */
  dropped: number;
  /** Share of the winning text's 8-word runs still present in the prompt (0..1). */
  leak: number;
};

/** A stored case result; runs before Phase 1c carry no `holdout`. */
export type GoldenCaseResult = AiEvalCaseResult & { holdout?: HoldoutReport };

export function words(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

export function shingles(text: string, n = HOLDOUT_SHINGLE): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

export type Golden = { text: string; runs: Set<string>; joined: string };

export function goldenOf(text: string): Golden {
  return { text, runs: shingles(text), joined: ` ${words(text).join(" ")} ` };
}

/** True when a snippet reproduces the winning text rather than merely sharing its topic. */
export function copiesGolden(snippet: string, golden: Golden): boolean {
  const w = words(snippet);
  if (w.length >= HOLDOUT_SHINGLE) {
    const runs = shingles(snippet);
    let shared = 0;
    for (const r of runs) if (golden.runs.has(r)) shared += 1;
    return runs.size > 0 && shared / runs.size >= HOLDOUT_MAX_OVERLAP;
  }
  return w.length >= MIN_PHRASE_WORDS && golden.joined.includes(` ${w.join(" ")} `);
}

/** Pattern intel with every snippet that copies the winning text removed. */
export function screenPatternIntel(
  intel: SectionDraftPatternIntel,
  golden: Golden,
): { intel: SectionDraftPatternIntel; dropped: number } {
  let dropped = 0;
  const keep = <T>(items: T[], textOf: (t: T) => string): T[] =>
    items.filter((t) => {
      const copy = copiesGolden(textOf(t), golden);
      if (copy) dropped += 1;
      return !copy;
    });

  const fb = intel.editFeedback;
  const ws = intel.writingSignals;
  const screened: SectionDraftPatternIntel = {
    ...intel,
    winningPatterns: keep(intel.winningPatterns, (p) => p.excerpt),
    lostPatterns: keep(intel.lostPatterns, (p) => p.excerpt),
    editFeedback: fb
      ? {
          ...fb,
          preferredPhrases: keep(fb.preferredPhrases, (p) => p),
          rejectedPhrases: keep(fb.rejectedPhrases, (p) => p),
          removedPhrases: keep(fb.removedPhrases, (p) => p),
        }
      : fb,
    writingSignals: ws
      ? {
          ...ws,
          reviewComments: keep(ws.reviewComments, (c) => c.body),
          debriefWeaknesses: keep(ws.debriefWeaknesses, (d) => `${d.weaknesses} ${d.improvements}`),
          winnerGaps: keep(ws.winnerGaps, (g) => `${g.gaps} ${g.recommendations}`),
        }
      : ws,
  };
  return { intel: screened, dropped };
}

/** Share of the winning text's runs that appear anywhere in the prompt (0 when the winner is too short to measure). */
export function promptLeak(promptText: string, golden: Golden): number {
  if (golden.runs.size === 0) return 0;
  const prompt = shingles(promptText);
  let found = 0;
  for (const r of golden.runs) if (prompt.has(r)) found += 1;
  return found / golden.runs.size;
}
