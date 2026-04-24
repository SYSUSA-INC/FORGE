import { and, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { proposalSections, proposals, users } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { Panel } from "@/components/ui/Panel";
import { listProposalTeamCandidates } from "../../actions";
import { SectionsClient } from "./SectionsClient";

export const dynamic = "force-dynamic";

export default async function ProposalSectionsPage({
  params,
}: {
  params: { id: string };
}) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [p] = await db
    .select({ id: proposals.id })
    .from(proposals)
    .where(
      and(
        eq(proposals.id, params.id),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!p) notFound();

  const sectionRows = await db
    .select({
      id: proposalSections.id,
      kind: proposalSections.kind,
      title: proposalSections.title,
      ordering: proposalSections.ordering,
      content: proposalSections.content,
      status: proposalSections.status,
      wordCount: proposalSections.wordCount,
      pageLimit: proposalSections.pageLimit,
      authorUserId: proposalSections.authorUserId,
      authorName: users.name,
      authorEmail: users.email,
    })
    .from(proposalSections)
    .leftJoin(users, eq(users.id, proposalSections.authorUserId))
    .where(eq(proposalSections.proposalId, params.id))
    .orderBy(asc(proposalSections.ordering));

  const team = await listProposalTeamCandidates();

  return (
    <Panel title="Sections" eyebrow="Author the proposal">
      <SectionsClient
        proposalId={params.id}
        sections={sectionRows.map((s) => ({
          id: s.id,
          kind: s.kind,
          title: s.title,
          ordering: s.ordering,
          content: s.content,
          status: s.status,
          wordCount: s.wordCount,
          pageLimit: s.pageLimit,
          authorUserId: s.authorUserId,
          authorName: s.authorName,
          authorEmail: s.authorEmail,
        }))}
        team={team}
      />
    </Panel>
  );
}
