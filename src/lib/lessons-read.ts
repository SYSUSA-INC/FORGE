import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { opportunities, opportunityLessonApplications, opportunityLessons, proposals } from "@/db/schema";
import { lessonLoopSummary, lessonsMatching, parseLessonCitations, type LessonAppliesTo, type LessonMatchContext } from "@/lib/lessons";
import { log } from "@/lib/log";

/**
 * BL-LESSONS-LOOP phase 4b — the one read every consumer uses: confirmed
 * lessons only, matched to a bid or a section. A proposed or retired
 * lesson is never returned. And the write every drafter makes: a draft
 * that cites "[Lesson n]" records an application of that lesson.
 */
export type ApplicableLesson = {
  id: string;
  kind: string;
  text: string;
  appliesTo: LessonAppliesTo;
  /** The bid it came from. */
  fromTitle: string;
  fromProposalId: string | null;
};

const LESSONS_MAX = 8;

export async function lessonsForContext(organizationId: string, ctx: LessonMatchContext, max = LESSONS_MAX): Promise<ApplicableLesson[]> {
  const rows = await db
    .select({
      id: opportunityLessons.id,
      kind: opportunityLessons.kind,
      text: opportunityLessons.text,
      appliesTo: opportunityLessons.appliesTo,
      proposalId: opportunityLessons.proposalId,
      confirmedAt: opportunityLessons.confirmedAt,
      opportunityTitle: opportunities.title,
      proposalTitle: proposals.title,
    })
    .from(opportunityLessons)
    .innerJoin(opportunities, eq(opportunities.id, opportunityLessons.opportunityId))
    .leftJoin(proposals, eq(proposals.id, opportunityLessons.proposalId))
    .where(and(eq(opportunityLessons.organizationId, organizationId), eq(opportunityLessons.status, "confirmed")))
    .limit(500);
  const matched = lessonsMatching(rows, ctx).sort((a, b) => (b.confirmedAt?.getTime() ?? 0) - (a.confirmedAt?.getTime() ?? 0));
  return matched.slice(0, max).map((r) => ({
    id: r.id,
    kind: r.kind,
    text: r.text,
    appliesTo: r.appliesTo,
    fromTitle: r.proposalTitle ?? r.opportunityTitle,
    fromProposalId: r.proposalId,
  }));
}

/**
 * Record the lessons a produced draft cites, once per lesson, proposal
 * and section; the lesson's applied count follows. Best-effort: a
 * failure here never fails the draft.
 */
export async function recordLessonApplications(input: {
  organizationId: string;
  proposalId: string;
  sectionId: string;
  userId: string | null;
  draftText: string;
  /** The numbered lessons the prompt offered, in order ([Lesson 1] is index 0). */
  offered: { id: string }[];
}): Promise<number> {
  if (input.offered.length === 0) return 0;
  const cited = parseLessonCitations(input.draftText, input.offered.length).map((n) => input.offered[n - 1]!.id);
  if (cited.length === 0) return 0;
  let recorded = 0;
  try {
    for (const lessonId of cited) {
      const [existing] = await db
        .select({ id: opportunityLessonApplications.id })
        .from(opportunityLessonApplications)
        .where(
          and(
            eq(opportunityLessonApplications.organizationId, input.organizationId),
            eq(opportunityLessonApplications.lessonId, lessonId),
            eq(opportunityLessonApplications.proposalId, input.proposalId),
            eq(opportunityLessonApplications.sectionId, input.sectionId),
          ),
        )
        .limit(1);
      if (existing) continue;
      await db.insert(opportunityLessonApplications).values({ organizationId: input.organizationId, lessonId, proposalId: input.proposalId, sectionId: input.sectionId, appliedByUserId: input.userId });
      await db
        .update(opportunityLessons)
        .set({ appliedCount: sql`${opportunityLessons.appliedCount} + 1` })
        .where(and(eq(opportunityLessons.id, lessonId), eq(opportunityLessons.organizationId, input.organizationId)));
      recorded += 1;
    }
  } catch (err) {
    log.warn("[recordLessonApplications]", "failed", { error: err });
  }
  return recorded;
}

/**
 * Phase 4c — when a proposal is decided, every application recorded on
 * it learns the outcome, so the Lessons page can say whether applying
 * the lesson closed the loop. Best-effort; org-scoped.
 */
export async function recordLessonOutcomes(input: { organizationId: string; proposalId: string; outcomeType: "won" | "lost" | null }): Promise<void> {
  try {
    await db
      .update(opportunityLessonApplications)
      .set({ outcomeType: input.outcomeType })
      .where(and(eq(opportunityLessonApplications.organizationId, input.organizationId), eq(opportunityLessonApplications.proposalId, input.proposalId)));
  } catch (err) {
    log.warn("[recordLessonOutcomes]", "failed", { error: err });
  }
}

/** The loop in numbers, for the Command Center and Reports. */
export async function lessonLoopStats(organizationId: string): Promise<{ proposed: number; confirmed: number; applied: number; closed: number }> {
  const rows = await db
    .select({ id: opportunityLessons.id, status: opportunityLessons.status })
    .from(opportunityLessons)
    .where(eq(opportunityLessons.organizationId, organizationId));
  const apps = rows.length
    ? await db
        .select({ lessonId: opportunityLessonApplications.lessonId, outcomeType: opportunityLessonApplications.outcomeType })
        .from(opportunityLessonApplications)
        .where(eq(opportunityLessonApplications.organizationId, organizationId))
    : [];
  const byLesson = new Map<string, { outcomeType: string | null }[]>();
  for (const a of apps) byLesson.set(a.lessonId, [...(byLesson.get(a.lessonId) ?? []), { outcomeType: a.outcomeType }]);
  return lessonLoopSummary(rows.map((r) => ({ status: r.status, applications: byLesson.get(r.id) ?? [] })));
}
