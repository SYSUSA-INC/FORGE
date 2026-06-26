import { and, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  proposalScanResults,
  proposalSections,
  proposals,
  users,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { Panel } from "@/components/ui/Panel";
import { listProposalTeamCandidates } from "../../actions";
import { triggerProposalScanIfStaleAction } from "../scan-actions";
import { AutoDraftButton } from "./ai/AutoDraftButton";
import { SectionsClient } from "./SectionsClient";

export const dynamic = "force-dynamic";

export default async function ProposalSectionsPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await requireAuth();
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
      bodyDoc: proposalSections.bodyDoc,
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

  // BL-FB-SCAN-CONTINUOUS — pull the latest persisted health scan so
  // every section list row can show its red/amber/green status dot.
  // Also fire a debounced re-scan if the proposal is stale (dirty +
  // outside the debounce window) so the next page load reflects edits.
  const [scanRow] = await db
    .select({ sectionIssues: proposalScanResults.sectionIssues })
    .from(proposalScanResults)
    .where(
      and(
        eq(proposalScanResults.proposalId, params.id),
        eq(proposalScanResults.organizationId, organizationId),
      ),
    )
    .limit(1);
  const issueBySection = new Map<
    string,
    { severity: "high" | "medium" | "low"; issue: string }
  >();
  for (const i of scanRow?.sectionIssues ?? []) {
    issueBySection.set(i.sectionId, {
      severity: i.severity,
      issue: i.issue,
    });
  }
  void triggerProposalScanIfStaleAction(params.id);

  return (
    <Panel
      title="Sections"
      eyebrow="Author the proposal"
      actions={<AutoDraftButton proposalId={params.id} />}
    >
      <SectionsClient
        proposalId={params.id}
        sections={sectionRows.map((s) => {
          const issue = issueBySection.get(s.id);
          return {
            id: s.id,
            kind: s.kind,
            title: s.title,
            ordering: s.ordering,
            content: s.content,
            bodyDoc: s.bodyDoc,
            status: s.status,
            wordCount: s.wordCount,
            pageLimit: s.pageLimit,
            authorUserId: s.authorUserId,
            authorName: s.authorName,
            authorEmail: s.authorEmail,
            scanSeverity: issue?.severity ?? null,
            scanIssue: issue?.issue ?? null,
          };
        })}
        team={team}
        currentUser={{
          id: user.id,
          displayName: user.name || user.email || user.id,
        }}
      />
    </Panel>
  );
}
