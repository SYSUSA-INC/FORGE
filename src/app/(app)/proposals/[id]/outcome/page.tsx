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

export const dynamic = "force-dynamic";

export default async function ProposalOutcomePage({
  params,
}: {
  params: { id: string };
}) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [p] = await db
    .select({
      id: proposals.id,
      stage: proposals.stage,
      title: proposals.title,
      submittedAt: proposals.submittedAt,
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
    .where(eq(proposalOutcomes.proposalId, params.id))
    .limit(1);

  const [debriefRow] = await db
    .select({
      d: proposalDebriefs,
      authorName: users.name,
      authorEmail: users.email,
    })
    .from(proposalDebriefs)
    .leftJoin(users, eq(users.id, proposalDebriefs.createdByUserId))
    .where(eq(proposalDebriefs.proposalId, params.id))
    .limit(1);

  return (
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
  );
}
