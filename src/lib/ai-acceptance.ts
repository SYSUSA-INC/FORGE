/**
 * BL-AIX Phase 0b — measuring how much AI text a team actually keeps.
 *
 * The old measure counted an AI word as kept when the same word appeared
 * anywhere in the saved section ("the", "and", "shall" always do) and
 * graded it at the first save after the draft, often before anyone had
 * read it. These helpers replace it:
 *   - shingleRetention: the share of the draft's four-word runs still
 *     present in the saved text, so common words cannot inflate it.
 *   - shouldResolveDraft: grade only once the owner has finished
 *     reviewing (no pending tracked changes) and the draft has had time
 *     to be worked on.
 *   - aiSuggestionAcceptance: word-weighted acceptance of FORGE AI's
 *     tracked suggestions, with accept-all / reject-all counting less
 *     than a decision made one suggestion at a time.
 *
 * Pure: no DB, unit-tested.
 */

const SHINGLE = 4;

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+(?:['’][a-z]+)?/g) ?? [];
}

function shingles(tokens: string[], n: number): string[] {
  if (tokens.length === 0) return [];
  if (tokens.length < n) return [tokens.join(" ")];
  const out: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) out.push(tokens.slice(i, i + n).join(" "));
  return out;
}

/** Share (0..1) of the AI text's four-word runs that survive in the saved text. */
export function shingleRetention(aiText: string, savedText: string): { fraction: number; keptWords: number } {
  const aiTokens = words(aiText);
  if (aiTokens.length === 0) return { fraction: 0, keptWords: 0 };
  const savedTokens = words(savedText);
  const n = Math.min(SHINGLE, aiTokens.length);
  const saved = new Set(shingles(savedTokens, n));
  const runs = shingles(aiTokens, n);
  const kept = runs.filter((s) => saved.has(s)).length;
  const fraction = runs.length === 0 ? 0 : kept / runs.length;
  return { fraction, keptWords: Math.round(fraction * aiTokens.length) };
}

/** A draft is graded no sooner than this after it was produced. */
export const MIN_DRAFT_AGE_MS = 30 * 60_000;

/**
 * Grade a pending draft on this save? Not while tracked suggestions are
 * still open (the owner hasn't decided), and not in the first half hour
 * (the save that inserted it, or the next keystroke, says nothing).
 */
export function shouldResolveDraft(input: { draftCreatedAt: Date; now: Date; savedHasPendingChanges: boolean }): boolean {
  if (input.savedHasPendingChanges) return false;
  return input.now.getTime() - input.draftCreatedAt.getTime() >= MIN_DRAFT_AGE_MS;
}

/** How much an accept-all / reject-all decision counts next to a one-by-one decision. */
export const BULK_DECISION_WEIGHT = 0.5;

export type AiDecision = { decision: "accept" | "reject"; bulk: boolean; wordCount: number };

/**
 * Word-weighted share of FORGE AI's suggestions the owners accepted, or
 * null with nothing decided. A one-word suggestion counts as one word, so
 * a pile of accepted typo fixes cannot outweigh a rejected paragraph.
 */
export function aiSuggestionAcceptance(decisions: AiDecision[]): { decided: number; rate: number } | null {
  let accepted = 0;
  let total = 0;
  for (const d of decisions) {
    const weight = Math.max(1, d.wordCount) * (d.bulk ? BULK_DECISION_WEIGHT : 1);
    total += weight;
    if (d.decision === "accept") accepted += weight;
  }
  return total > 0 ? { decided: decisions.length, rate: accepted / total } : null;
}
