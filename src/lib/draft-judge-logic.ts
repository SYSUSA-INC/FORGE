/**
 * BL-AIX Phase 1h-2 — the rubric a draft is judged on, and how well the
 * AI judge agrees with the organization's own experts. Pure; tested.
 *
 * The judge never sees the winning text: it scores a draft the way an
 * evaluator would, against the section's requirements and Section M, so
 * the same judge can later score drafts that have no winner to compare
 * with. Experts rate the same drafts on the same 1-5 scale; the judge is
 * trusted only once enough of their ratings agree with it.
 */

export const JUDGE_DIMENSIONS = ["compliance", "evaluation", "specificity", "clarity"] as const;
export type JudgeDimension = (typeof JUDGE_DIMENSIONS)[number];

export const JUDGE_DIMENSION_LABELS: Record<JudgeDimension, { label: string; describe: string }> = {
  compliance: { label: "Compliance", describe: "Answers every requirement mapped to the section, in the order and terms the solicitation uses." },
  evaluation: { label: "Evaluation fit", describe: "Gives the evaluator reasons to assign strengths under Section M: benefits, proof, discriminators." },
  specificity: { label: "Specificity", describe: "Concrete, verifiable detail (names, numbers, methods, outcomes) rather than generic claims." },
  clarity: { label: "Clarity", describe: "Easy to score: clear structure, plain language, no filler or contradictions." },
};

export type JudgeScores = Record<JudgeDimension, number> & { overall: number };

/** Whole scores from 1 to 5; null when a value is missing or unusable. */
export function cleanScores(raw: Partial<Record<JudgeDimension | "overall", unknown>>): JudgeScores | null {
  const out: Partial<JudgeScores> = {};
  for (const key of [...JUDGE_DIMENSIONS, "overall"] as const) {
    const n = Number(raw[key]);
    if (!Number.isFinite(n)) return null;
    out[key] = Math.min(5, Math.max(1, Math.round(n)));
  }
  return out as JudgeScores;
}

/** Spearman rank correlation, ties given their average rank; null below 3 pairs or when either side is constant. */
export function spearman(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 3) return null;
  const rank = (xs: number[]) => {
    const order = xs.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array<number>(xs.length);
    for (let i = 0; i < order.length; ) {
      let j = i;
      while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
      for (let k = i; k <= j; k++) r[order[k]![1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a);
  const rb = rank(b);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i]! - ma) * (rb[i]! - mb);
    da += (ra[i]! - ma) ** 2;
    db += (rb[i]! - mb) ** 2;
  }
  return da === 0 || db === 0 ? null : num / Math.sqrt(da * db);
}

export type Agreement = {
  /** Drafts both the judge and an expert scored. */
  n: number;
  /** Mean |judge − expert| on the overall score. */
  meanAbsDiff: number | null;
  /** Share of drafts where the two are at most one point apart. */
  withinOne: number | null;
  spearman: number | null;
  verdict: "collecting" | "calibrated" | "disagrees";
};

/** The judge is trusted from this many expert-rated drafts on. */
export const CALIBRATION_MIN_PAIRS = 10;

export function agreement(pairs: { judge: number; expert: number }[]): Agreement {
  const n = pairs.length;
  if (n === 0) return { n, meanAbsDiff: null, withinOne: null, spearman: null, verdict: "collecting" };
  const diffs = pairs.map((p) => Math.abs(p.judge - p.expert));
  const meanAbsDiff = diffs.reduce((s, d) => s + d, 0) / n;
  const withinOne = diffs.filter((d) => d <= 1).length / n;
  const rho = spearman(pairs.map((p) => p.judge), pairs.map((p) => p.expert));
  let verdict: Agreement["verdict"] = "collecting";
  if (n >= CALIBRATION_MIN_PAIRS) {
    if (withinOne >= 0.8 && (rho === null || rho >= 0.5)) verdict = "calibrated";
    else if (withinOne < 0.6 || (rho !== null && rho < 0.2)) verdict = "disagrees";
  }
  return { n, meanAbsDiff, withinOne, spearman: rho, verdict };
}

/** Judge-vs-expert pairs from stored cases and ratings; several experts on one draft each count. */
export function judgePairs(
  cases: { runId: string; sectionId: string; judgeOverall: number | null }[],
  ratings: { runId: string; sectionId: string; overall: number }[],
): { judge: number; expert: number }[] {
  const judged = new Map(cases.filter((c) => c.judgeOverall !== null).map((c) => [`${c.runId}:${c.sectionId}`, c.judgeOverall as number]));
  const out: { judge: number; expert: number }[] = [];
  for (const r of ratings) {
    const j = judged.get(`${r.runId}:${r.sectionId}`);
    if (j !== undefined) out.push({ judge: j, expert: r.overall });
  }
  return out;
}
