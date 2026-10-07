/**
 * BL-AIX Phase 1h-2 — experts' ratings of golden-eval drafts, and how
 * well the draft judge agrees with them. Every read and write is scoped
 * to one organization; a rating can only name a draft from that
 * organization's own runs. Server-only lib, callers own auth.
 */
import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { aiEvalRatings, aiEvalRuns } from "@/db/schema";
import { agreement, cleanScores, judgePairs, JUDGE_DIMENSIONS, type Agreement, type JudgeScores } from "@/lib/draft-judge-logic";
import type { GoldenCaseResult } from "@/lib/golden-holdout";

export type RateResult = { ok: true } | { ok: false; error: string };

/** Record (or replace) one member's rating of one draft. */
export async function rateGoldenDraft(input: {
  organizationId: string;
  runId: string;
  sectionId: string;
  raterUserId: string;
  scores: Partial<JudgeScores>;
  note: string;
}): Promise<RateResult> {
  const { organizationId } = input;
  const scores = cleanScores(input.scores);
  if (!scores) return { ok: false, error: "Give every criterion and the overall a score from 1 to 5." };
  const [run] = await db
    .select({ results: aiEvalRuns.results })
    .from(aiEvalRuns)
    .where(and(eq(aiEvalRuns.id, input.runId), eq(aiEvalRuns.organizationId, organizationId)))
    .limit(1);
  if (!run) return { ok: false, error: "Eval run not found." };
  const draft = (run.results as GoldenCaseResult[]).find((c) => c.sectionId === input.sectionId);
  if (!draft?.draft) return { ok: false, error: "That draft is not stored on the run, so it cannot be rated." };

  const { overall, ...dims } = scores;
  const now = new Date();
  await db
    .insert(aiEvalRatings)
    .values({ organizationId, runId: input.runId, sectionId: input.sectionId, raterUserId: input.raterUserId, scores: dims, overall, note: input.note.trim().slice(0, 1_000) })
    .onConflictDoUpdate({
      target: [aiEvalRatings.runId, aiEvalRatings.sectionId, aiEvalRatings.raterUserId],
      set: { scores: dims, overall, note: input.note.trim().slice(0, 1_000), updatedAt: now },
    });
  return { ok: true };
}

export type DraftRating = { runId: string; sectionId: string; raterUserId: string; scores: JudgeScores; note: string };

export type JudgeCalibration = {
  overall: Agreement;
  /** Mean |judge − expert| per criterion, over the same pairs. */
  perDimension: Record<(typeof JUDGE_DIMENSIONS)[number], number | null>;
  ratings: number;
};

/** The organization's ratings on the given runs, and the judge's agreement with them across all its rated runs. */
export async function loadRatingsAndCalibration(input: {
  organizationId: string;
  runIds: string[];
}): Promise<{ ratings: DraftRating[]; calibration: JudgeCalibration }> {
  const { organizationId } = input;
  const rows = await db
    .select()
    .from(aiEvalRatings)
    .where(eq(aiEvalRatings.organizationId, organizationId))
    .orderBy(desc(aiEvalRatings.updatedAt))
    .limit(500);
  const ratedRunIds = [...new Set(rows.map((r) => r.runId))];
  const runs = ratedRunIds.length
    ? await db
        .select({ id: aiEvalRuns.id, results: aiEvalRuns.results })
        .from(aiEvalRuns)
        .where(and(eq(aiEvalRuns.organizationId, organizationId), inArray(aiEvalRuns.id, ratedRunIds)))
    : [];

  const judgeBy = new Map<string, JudgeScores>();
  for (const run of runs) {
    for (const c of run.results as GoldenCaseResult[]) {
      if (c.judge?.scores) judgeBy.set(`${run.id}:${c.sectionId}`, c.judge.scores);
    }
  }
  const ratings: DraftRating[] = rows.map((r) => ({
    runId: r.runId,
    sectionId: r.sectionId,
    raterUserId: r.raterUserId,
    scores: { ...(r.scores as Record<(typeof JUDGE_DIMENSIONS)[number], number>), overall: r.overall },
    note: r.note,
  }));

  const pairs = judgePairs(
    [...judgeBy.entries()].map(([key, s]) => {
      const [runId, sectionId] = key.split(":") as [string, string];
      return { runId, sectionId, judgeOverall: s.overall };
    }),
    ratings.map((r) => ({ runId: r.runId, sectionId: r.sectionId, overall: r.scores.overall })),
  );
  const perDimension = Object.fromEntries(
    JUDGE_DIMENSIONS.map((d) => {
      const diffs = ratings
        .map((r) => {
          const j = judgeBy.get(`${r.runId}:${r.sectionId}`);
          return j ? Math.abs(j[d] - r.scores[d]) : null;
        })
        .filter((x): x is number => x !== null);
      return [d, diffs.length ? diffs.reduce((s, x) => s + x, 0) / diffs.length : null];
    }),
  ) as JudgeCalibration["perDimension"];

  const wanted = new Set(input.runIds);
  return {
    ratings: ratings.filter((r) => wanted.has(r.runId)),
    calibration: { overall: agreement(pairs), perDimension, ratings: rows.length },
  };
}
