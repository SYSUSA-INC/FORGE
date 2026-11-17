/**
 * BL-NAV-LIFECYCLE 5d-1 — the arithmetic behind "how much of the AI's
 * first draft survives each review" and "what happened to the reviewers'
 * suggestions". Pure: no DB, unit-tested (tests/ai/draft-learning.test.ts).
 * The reads and writes are in src/lib/draft-learning.ts.
 */
import { shingleRetention } from "@/lib/ai-acceptance";

/** A section's AI draft and the text to grade it against. */
export type RetentionInput = { sectionId: string; draftText: string; currentText: string };

export type SectionRetention = { sectionId: string; draftWordCount: number; keptWordCount: number; keptFraction: number };

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Grade each section's AI draft against its text now. A draft with no words measures nothing and is left out. */
export function measureRetention(inputs: RetentionInput[]): SectionRetention[] {
  const out: SectionRetention[] = [];
  for (const input of inputs) {
    const draftWordCount = wordCount(input.draftText);
    if (draftWordCount === 0) continue;
    const { fraction, keptWords } = shingleRetention(input.draftText, input.currentText);
    out.push({ sectionId: input.sectionId, draftWordCount, keptWordCount: Math.min(keptWords, draftWordCount), keptFraction: fraction });
  }
  return out;
}

/** The share kept across sections, weighted by the size of each draft; null with nothing measured. */
export function keptShare(rows: { draftWordCount: number; keptWordCount: number }[]): number | null {
  const draft = rows.reduce((n, r) => n + Math.max(0, r.draftWordCount), 0);
  if (draft === 0) return null;
  const kept = rows.reduce((n, r) => n + Math.max(0, Math.min(r.keptWordCount, r.draftWordCount)), 0);
  return kept / draft;
}

/** Newest first in, one per section out: the draft a section's text is graded against. */
export function latestPerSection<T extends { sectionId: string }>(newestFirst: T[]): T[] {
  const seen = new Set<string>();
  return newestFirst.filter((row) => (seen.has(row.sectionId) ? false : (seen.add(row.sectionId), true)));
}

export type RetentionRow = {
  reviewId: string;
  reviewColor: string;
  /** When the round started (ISO), or null. */
  startedAt: string | null;
  draftWordCount: number;
  keptWordCount: number;
};

export type ReviewRetention = {
  reviewId: string;
  color: string;
  startedAt: string | null;
  sections: number;
  keptShare: number | null;
};

/** One line per review round, oldest first: the share of the AI draft still there when it started. */
export function retentionByReview(rows: RetentionRow[]): ReviewRetention[] {
  const byReview = new Map<string, RetentionRow[]>();
  for (const row of rows) byReview.set(row.reviewId, [...(byReview.get(row.reviewId) ?? []), row]);
  return [...byReview.values()]
    .map((group) => ({
      reviewId: group[0]!.reviewId,
      color: group[0]!.reviewColor,
      startedAt: group[0]!.startedAt,
      sections: group.length,
      keptShare: keptShare(group),
    }))
    .sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
}

export type ReviewerDecisionRow = { reviewColor: string; decision: string; n: number };

export type ReviewerDecisionStat = { color: string; decided: number; acceptRate: number };

/** Reviewers' suggestions decided so far, per colour team, in the order the colours are given. */
export function reviewerDecisionStats(rows: ReviewerDecisionRow[], colorOrder: readonly string[]): ReviewerDecisionStat[] {
  const tally = new Map<string, { accepted: number; decided: number }>();
  for (const row of rows) {
    if (row.decision !== "accept" && row.decision !== "reject") continue;
    const t = tally.get(row.reviewColor) ?? { accepted: 0, decided: 0 };
    t.decided += row.n;
    if (row.decision === "accept") t.accepted += row.n;
    tally.set(row.reviewColor, t);
  }
  const rank = (color: string) => {
    const i = colorOrder.indexOf(color);
    return i === -1 ? colorOrder.length : i;
  };
  return [...tally.entries()]
    .filter(([, t]) => t.decided > 0)
    .map(([color, t]) => ({ color, decided: t.decided, acceptRate: t.accepted / t.decided }))
    .sort((a, b) => rank(a.color) - rank(b.color));
}

/**
 * Which round a suggestion's author was reviewing in: the newest started
 * round of the proposal that names them. `newestFirst` is every (round,
 * reviewer) pair of the proposal's started rounds.
 */
export function roundByReviewer(
  newestFirst: { userId: string; reviewId: string; color: string }[],
): Map<string, { reviewId: string; color: string }> {
  const out = new Map<string, { reviewId: string; color: string }>();
  for (const row of newestFirst) if (!out.has(row.userId)) out.set(row.userId, { reviewId: row.reviewId, color: row.color });
  return out;
}
