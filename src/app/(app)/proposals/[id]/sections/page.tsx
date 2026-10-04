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
import { runInBackground } from "@/lib/background";
import { listOpenReviewCommentsBySection } from "@/lib/section-review-comments";
import type { SectionReviewComment } from "@/lib/review-comments";
import { unreadChatCounts } from "@/lib/section-chat";
import { getHouseStyle, voiceAuthorIds } from "@/lib/voice";
import { AutoDraftButton } from "./ai/AutoDraftButton";
import { SectionsClient } from "./SectionsClient";

export const dynamic = "force-dynamic";

export default async function ProposalSectionsPage({
  params,
  searchParams,
}: {
  params: { id: string };
  /** BL-FB-CHAT-MULTI — a mention notification opens its section with the chat showing, scrolled to the message (Slice 2). */
  searchParams?: { section?: string; tab?: string; message?: string };
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

  // BL-FB-GEN-VOICE Slice 2 — whose sections the drafter writes in their
  // own voice, and whether the team has a house style (header chips).
  const [voiceAuthors, style, chatUnread] = await Promise.all([
    voiceAuthorIds({ organizationId }).catch(() => [] as string[]),
    getHouseStyle({ organizationId }).catch(() => ({ orgName: "", houseStyle: "" })),
    // BL-FB-CHAT-MULTI Slice 2 — thread messages by teammates since this viewer last looked, per section.
    unreadChatCounts({ organizationId, proposalId: params.id, viewerUserId: user.id }).catch(() => ({}) as Record<string, number>),
  ]);

  // BL-AIP-6b — open colour-team review comments, shown and resolvable
  // per section inside the editor.
  const openComments: Record<string, SectionReviewComment[]> = await listOpenReviewCommentsBySection({
    organizationId,
    proposalId: params.id,
  }).catch(() => ({}));

  // BL-FB-SCAN-CONTINUOUS — pull the latest persisted health scan so
  // every section list row can show its red/amber/green status dot.
  // Also fire a debounced re-scan if the proposal is stale (dirty +
  // outside the debounce window) so the next page load reflects edits.
  const [scanRow] = await db
    .select({
      sectionIssues: proposalScanResults.sectionIssues,
      sectionThemeCoverage: proposalScanResults.sectionThemeCoverage,
    })
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
  const coverageBySection = new Map<
    string,
    { reinforced: number; total: number }
  >();
  for (const c of scanRow?.sectionThemeCoverage ?? []) {
    coverageBySection.set(c.sectionId, {
      reinforced: c.reinforced.length,
      total: c.reinforced.length + c.missing.length,
    });
  }
  runInBackground("[sections page] scan trigger", () =>
    triggerProposalScanIfStaleAction(params.id),
  );

  return (
    <Panel
      title="Sections"
      eyebrow="Author the proposal"
      actions={<AutoDraftButton proposalId={params.id} />}
    >
      <SectionsClient
        proposalId={params.id}
        initialSectionId={typeof searchParams?.section === "string" ? searchParams.section : null}
        initialTab={searchParams?.tab === "chat" ? "chat" : null}
        initialMessageId={typeof searchParams?.message === "string" ? searchParams.message : null}
        sections={sectionRows.map((s) => {
          const issue = issueBySection.get(s.id);
          const coverage = coverageBySection.get(s.id);
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
            themeReinforced: coverage?.reinforced ?? null,
            themeTotal: coverage?.total ?? null,
            reviewComments: openComments[s.id] ?? [],
            chatUnread: chatUnread[s.id] ?? 0,
          };
        })}
        team={team}
        currentUser={{
          id: user.id,
          displayName: user.name || user.email || user.id,
        }}
        voiceAuthorIds={voiceAuthors}
        houseStyle={style.houseStyle.trim().length > 0}
      />
    </Panel>
  );
}
