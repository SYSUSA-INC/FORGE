/**
 * BL-AIP-7a — briefs, pure parts: the serialisable shape client
 * components render, the grading rule, the freshness rule and the
 * track summary. Unit-tested.
 */

export type BriefRecommendation = "pursue" | "watch" | "no_bid";
export type BriefOutcome = "won" | "lost" | "no_bid";
export type BriefGrade = "correct" | "wrong" | "inconclusive";
export type BriefFeedback = "useful" | "not_useful";

/** What the panels render; every field is plain JSON. */
export type StoredBrief = {
  id: string;
  kind: "pursuit" | "pipeline";
  opportunityId: string | null;
  text: string;
  recommendation: BriefRecommendation | null;
  confidence: number | null;
  /** Pursuit: key signals. Pipeline: risks. */
  signals: string[];
  /** Pursuit: next actions. Pipeline: priorities. */
  nextActions: string[];
  model: string;
  stubbed: boolean;
  promptVersion: string;
  feedback: BriefFeedback | null;
  outcome: BriefOutcome | null;
  grade: BriefGrade | null;
  createdAt: string;
};

export type BriefTrack = {
  n: number;
  correct: number;
  wrong: number;
  inconclusive: number;
  /** correct / (correct + wrong); null until one decisive call exists. */
  accuracy: number | null;
};

/** A stored brief is reused instead of regenerated while this young. */
export const BRIEF_MAX_AGE_MS = 24 * 60 * 60_000;

export const RECOMMENDATION_LABELS: Record<BriefRecommendation, string> = {
  pursue: "Pursue",
  watch: "Watch",
  no_bid: "Consider no-bid",
};

export function isRecommendation(v: unknown): v is BriefRecommendation {
  return v === "pursue" || v === "watch" || v === "no_bid";
}

/**
 * Was the brief's call right, given how the pursuit ended? "Watch" is a
 * hedge, so it is never right or wrong.
 */
export function gradeRecommendation(
  recommendation: BriefRecommendation | null,
  outcome: BriefOutcome,
): BriefGrade {
  if (recommendation === "pursue") return outcome === "won" ? "correct" : "wrong";
  if (recommendation === "no_bid") return outcome === "won" ? "wrong" : "correct";
  return "inconclusive";
}

/** Reuse the stored brief when the snapshot is unchanged and it is recent. */
export function briefIsFresh(
  stored: { snapshotKey: string; createdAt: Date | string },
  currentKey: string,
  now: Date = new Date(),
): boolean {
  if (stored.snapshotKey !== currentKey) return false;
  const created = new Date(stored.createdAt).getTime();
  return now.getTime() - created < BRIEF_MAX_AGE_MS;
}

/** Stable key for "has anything that matters changed since the last brief". */
export function snapshotKeyOf(parts: Record<string, unknown>): string {
  const ordered = Object.keys(parts)
    .sort()
    .map((k) => `${k}=${JSON.stringify(parts[k] ?? null)}`)
    .join("&");
  return ordered.slice(0, 500);
}

export function summarizeBriefTrack(rows: { grade: string | null }[]): BriefTrack {
  let correct = 0;
  let wrong = 0;
  let inconclusive = 0;
  for (const r of rows) {
    if (r.grade === "correct") correct++;
    else if (r.grade === "wrong") wrong++;
    else if (r.grade === "inconclusive") inconclusive++;
  }
  const decisive = correct + wrong;
  return {
    n: correct + wrong + inconclusive,
    correct,
    wrong,
    inconclusive,
    accuracy: decisive === 0 ? null : Math.round((correct / decisive) * 1000) / 1000,
  };
}

/** Bound and clean a list of short strings from the model. */
export function cleanList(v: unknown, max: number, maxLen = 240): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") continue;
    const s = item.trim().replace(/\s+/g, " ").slice(0, maxLen);
    if (s) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

export function clampConfidence(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(1, Math.round(v * 100) / 100));
}
