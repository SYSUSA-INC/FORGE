import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  proposalDebriefs,
  proposalOutcomes,
  proposals,
  users,
  type ProposalOutcomeReason,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { OutcomeClient } from "./OutcomeClient";
import { listLessons } from "@/lib/lessons-draft";
import { safeQuery } from "@/lib/schema-resilience";
import { LessonsList, type LessonView } from "./LessonsList";

export const dynamic = "force-dynamic";

export default async function ProposalOutcomePage({
  params,
}: {
  params: { id: string };
}) {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [p] = await db
    .select({
      id: proposals.id,
      stage: proposals.stage,
      title: proposals.title,
      submittedAt: proposals.submittedAt,
      opportunityId: proposals.opportunityId,
    })
    .from(proposals)
    .where(
      and(
        eq(proposals.id, params.id),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!p) notFound();

  const [outcomeRow] = await db
    .select({
      o: proposalOutcomes,
      authorName: users.name,
      authorEmail: users.email,
    })
    .from(proposalOutcomes)
    .leftJoin(users, eq(users.id, proposalOutcomes.createdByUserId))
    .where(
      and(
        eq(proposalOutcomes.organizationId, organizationId),
        eq(proposalOutcomes.proposalId, params.id),
      ),
    )
    .limit(1);

  const [debriefRow] = await db
    .select({
      d: proposalDebriefs,
      authorName: users.name,
      authorEmail: users.email,
    })
    .from(proposalDebriefs)
    .leftJoin(users, eq(users.id, proposalDebriefs.createdByUserId))
    .where(
      and(
        eq(proposalDebriefs.organizationId, organizationId),
        eq(proposalDebriefs.proposalId, params.id),
      ),
    )
    .limit(1);

  // BL-LESSONS-LOOP — the lessons this bid taught, below the outcome.
  const CONFIRM_ROLES = ["admin", "capture"];
  const canConfirm = user.isSuperadmin || (!!user.role && CONFIRM_ROLES.includes(user.role));
  const lessonRows = p.opportunityId
    ? await safeQuery(() => listLessons({ organizationId, opportunityId: p.opportunityId! }), [], { tag: "outcome.lessons" })
    : [];
  const lessons: LessonView[] = lessonRows.map((r) => ({
    ...r,
    confirmedAt: r.confirmedAt ? r.confirmedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <>
    <OutcomeClient
      proposalId={params.id}
      currentStage={p.stage}
      submittedAt={p.submittedAt ? p.submittedAt.toISOString() : null}
      outcome={
        outcomeRow
          ? {
              outcomeType: outcomeRow.o.outcomeType,
              awardValue: outcomeRow.o.awardValue,
              decisionDate: outcomeRow.o.decisionDate
                ? outcomeRow.o.decisionDate.toISOString().slice(0, 10)
                : "",
              reasons: (outcomeRow.o.reasons ?? []) as ProposalOutcomeReason[],
              summary: outcomeRow.o.summary,
              lessonsLearned: outcomeRow.o.lessonsLearned,
              followUpActions: outcomeRow.o.followUpActions,
              awardedToCompetitor: outcomeRow.o.awardedToCompetitor,
              authorLabel:
                outcomeRow.authorName ?? outcomeRow.authorEmail ?? null,
              updatedAt: outcomeRow.o.updatedAt.toISOString(),
            }
          : null
      }
      debrief={
        debriefRow
          ? {
              status: debriefRow.d.status,
              format: debriefRow.d.format,
              requestedAt: debriefRow.d.requestedAt
                ? debriefRow.d.requestedAt.toISOString().slice(0, 10)
                : "",
              scheduledFor: debriefRow.d.scheduledFor
                ? debriefRow.d.scheduledFor.toISOString().slice(0, 10)
                : "",
              heldOn: debriefRow.d.heldOn
                ? debriefRow.d.heldOn.toISOString().slice(0, 10)
                : "",
              governmentAttendees: debriefRow.d.governmentAttendees,
              ourAttendees: debriefRow.d.ourAttendees,
              strengths: debriefRow.d.strengths,
              weaknesses: debriefRow.d.weaknesses,
              improvements: debriefRow.d.improvements,
              pastPerformanceCitation: debriefRow.d.pastPerformanceCitation,
              notes: debriefRow.d.notes,
              authorLabel:
                debriefRow.authorName ?? debriefRow.authorEmail ?? null,
              updatedAt: debriefRow.d.updatedAt.toISOString(),
            }
          : null
      }
    />
    <div className="mt-4">
      <LessonsList lessons={lessons} canConfirm={canConfirm} proposalId={params.id} title="Lessons from this bid" />
    </div>
    </>
  );
}
