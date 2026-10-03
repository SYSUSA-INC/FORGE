import Link from "next/link";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  proposalReviewAssignments,
  proposalReviewComments,
  proposalReviews,
  proposalSections,
  proposals,
  users,
} from "@/db/schema";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import {
  REVIEW_COLOR_HEX,
  REVIEW_COLOR_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  VERDICT_COLORS,
  VERDICT_LABELS,
  computeOverallVerdict,
} from "@/lib/review-types";
import { getReviewWorkflow } from "@/lib/review-workflow";
import { checklistProgress, consolidateComments, consolidatedReport } from "@/lib/review-workflow-logic";
import { ReviewerList } from "./ReviewerList";
import { SubmitVerdictPanel } from "./SubmitVerdictPanel";
import { CommentsPanel } from "./CommentsPanel";
import { CloseReviewPanel } from "./CloseReviewPanel";
import { ChecklistPanel } from "./ChecklistPanel";
import { ConsolidatedReport } from "./ConsolidatedReport";
import { CoveragePanel } from "./CoveragePanel";
import { ReviewSummaryPanel } from "./ReviewSummaryPanel";
import { listOrgReviewers } from "../actions";

export const dynamic = "force-dynamic";

export default async function ReviewDetailPage({
  params,
}: {
  params: { id: string; reviewId: string };
}) {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [review] = await db
    .select()
    .from(proposalReviews)
    .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
    .where(
      and(
        eq(proposalReviews.id, params.reviewId),
        eq(proposalReviews.proposalId, params.id),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!review) notFound();
  const r = review.proposal_review;

  const assignmentRows = await db
    .select({
      userId: proposalReviewAssignments.userId,
      verdict: proposalReviewAssignments.verdict,
      summary: proposalReviewAssignments.summary,
      submittedAt: proposalReviewAssignments.submittedAt,
      name: users.name,
      email: users.email,
    })
    .from(proposalReviewAssignments)
    .leftJoin(users, eq(users.id, proposalReviewAssignments.userId))
    .where(eq(proposalReviewAssignments.reviewId, r.id));

  const sections = await db
    .select({
      id: proposalSections.id,
      title: proposalSections.title,
      ordering: proposalSections.ordering,
    })
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, params.id))
    .orderBy(asc(proposalSections.ordering));

  const commentRows = await db
    .select({
      id: proposalReviewComments.id,
      sectionId: proposalReviewComments.sectionId,
      userId: proposalReviewComments.userId,
      body: proposalReviewComments.body,
      resolved: proposalReviewComments.resolved,
      createdAt: proposalReviewComments.createdAt,
      authorName: users.name,
      authorEmail: users.email,
      carriedFromCommentId: proposalReviewComments.carriedFromCommentId,
    })
    .from(proposalReviewComments)
    .leftJoin(users, eq(users.id, proposalReviewComments.userId))
    .where(eq(proposalReviewComments.reviewId, r.id))
    .orderBy(desc(proposalReviewComments.createdAt));

  // Slice 2 — which earlier round each carried comment came from, and the round this one carries.
  const carriedIds = commentRows.map((c) => c.carriedFromCommentId).filter((id): id is string => !!id);
  const carriedSources =
    carriedIds.length === 0
      ? []
      : await db
          .select({ id: proposalReviewComments.id, color: proposalReviews.color })
          .from(proposalReviewComments)
          .innerJoin(proposalReviews, eq(proposalReviews.id, proposalReviewComments.reviewId))
          .where(inArray(proposalReviewComments.id, carriedIds));
  const carriedColor = new Map(carriedSources.map((s) => [s.id, REVIEW_COLOR_LABELS[s.color]] as const));
  const [carriedRound] = r.carriedFromReviewId
    ? await db.select({ color: proposalReviews.color }).from(proposalReviews).where(eq(proposalReviews.id, r.carriedFromReviewId)).limit(1)
    : [];

  const reviewers = await listOrgReviewers();
  const actorAssignment = assignmentRows.find((a) => a.userId === actor.id);
  const canClose = r.status === "in_progress";
  const overallVerdict = computeOverallVerdict(
    assignmentRows.map((a) => a.verdict ?? null),
  );

  // BL-FB-X-COLOR-TEAM — section scopes, checklist ticks, consolidated comments.
  const workflow = await getReviewWorkflow({ organizationId, reviewId: r.id });
  const roundReviewers = assignmentRows.map((a) => ({ userId: a.userId, name: a.name ?? null, email: a.email ?? "" }));
  const groups = consolidateComments(
    sections,
    commentRows.map((c) => ({
      id: c.id,
      sectionId: c.sectionId,
      body: c.body,
      resolved: c.resolved,
      authorName: c.userId ? c.authorName ?? c.authorEmail ?? "Reviewer" : null,
      createdAt: c.createdAt.toISOString(),
    })),
  );
  const sectionNumbers = Object.fromEntries(sections.map((s) => [s.id, s.ordering] as const));
  const report = consolidatedReport({
    proposalTitle: review.proposal.title,
    colorLabel: REVIEW_COLOR_LABELS[r.color],
    dueDate: r.dueDate ? new Date(r.dueDate).toLocaleDateString() : null,
    instructions: r.instructions,
    groups,
    sectionNumbers: new Map(Object.entries(sectionNumbers)),
    verdicts: assignmentRows.map((a) => ({
      name: a.name ?? a.email ?? "Reviewer",
      verdict: a.verdict ? VERDICT_LABELS[a.verdict] : null,
      summary: a.summary,
    })),
    checklist: checklistProgress(r.checklist, workflow.checklistStates, roundReviewers.map((x) => x.userId)),
  });

  const colorHex = REVIEW_COLOR_HEX[r.color];
  const statusColor = STATUS_COLORS[r.status];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-layer/10 bg-layer/[0.02] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/proposals/${params.id}/reviews`}
            className="font-mono text-[11px] text-muted hover:text-text"
          >
            ← All reviews
          </Link>
          <span
            className="rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-[0.22em]"
            style={{
              color: colorHex,
              backgroundColor: `${colorHex}1A`,
              border: `1px solid ${colorHex}40`,
            }}
          >
            {REVIEW_COLOR_LABELS[r.color]}
          </span>
          <span
            className="rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest"
            style={{
              color: statusColor,
              backgroundColor: `${statusColor}1A`,
              border: `1px solid ${statusColor}40`,
            }}
          >
            {STATUS_LABELS[r.status]}
          </span>
          {r.verdict ? (
            <span
              className="rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest"
              style={{
                color: VERDICT_COLORS[r.verdict],
                backgroundColor: `${VERDICT_COLORS[r.verdict]}1A`,
                border: `1px solid ${VERDICT_COLORS[r.verdict]}40`,
              }}
            >
              Final: {VERDICT_LABELS[r.verdict]}
            </span>
          ) : null}
          {r.dueDate ? (
            <span className="font-mono text-[10px] text-muted">
              Due {new Date(r.dueDate).toLocaleDateString()}
            </span>
          ) : null}
          {carriedRound ? (
            <span className="rounded border border-indigo-400/20 bg-indigo-400/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-indigo-300">
              Carries {REVIEW_COLOR_LABELS[carriedRound.color]} open comments
            </span>
          ) : null}
        </div>
      </div>

      {r.instructions ? (
        <div className="rounded-lg border border-indigo-400/20 bg-indigo-400/5 px-4 py-3">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-indigo-300">Instructions to reviewers</div>
          <p className="mt-1 whitespace-pre-wrap font-body text-[13px] leading-relaxed text-text">{r.instructions}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2 flex flex-col gap-4">
          <CoveragePanel
            reviewId={r.id}
            sections={sections}
            reviewers={roundReviewers}
            sectionAssignments={workflow.sectionAssignments}
            currentUserId={actor.id}
            canEdit={r.status === "in_progress"}
          />
          <ReviewSummaryPanel reviewId={r.id} summary={r.aiSummary ?? null} summaryAt={r.aiSummaryAt ? r.aiSummaryAt.toISOString() : null} />
          <CommentsPanel
            reviewId={r.id}
            proposalId={params.id}
            sections={sections}
            currentUserId={actor.id}
            isSuperadmin={actor.isSuperadmin}
            members={reviewers.map((m) => ({
              id: m.id,
              name: m.name,
              email: m.email,
            }))}
            comments={commentRows.map((c) => ({
              id: c.id,
              sectionId: c.sectionId,
              userId: c.userId,
              body: c.body,
              resolved: c.resolved,
              createdAt: c.createdAt.toISOString(),
              // BL-AIP-6 — pre-review comments carry no user; label them.
              authorName: c.authorName ?? (c.userId ? null : "FORGE AI"),
              authorEmail: c.authorEmail,
              carriedFrom: c.carriedFromCommentId ? carriedColor.get(c.carriedFromCommentId) ?? "an earlier round" : null,
            }))}
          />
        </div>

        <div className="flex flex-col gap-4">
          <ChecklistPanel
            reviewId={r.id}
            items={r.checklist}
            states={workflow.checklistStates}
            reviewers={roundReviewers}
            currentUserId={actor.id}
            canTick={!!actorAssignment && r.status === "in_progress"}
          />
          <ReviewerList
            reviewId={r.id}
            assignments={assignmentRows.map((a) => ({
              userId: a.userId,
              name: a.name ?? null,
              email: a.email ?? "",
              verdict: a.verdict ?? null,
              summary: a.summary,
              submittedAt: a.submittedAt ? a.submittedAt.toISOString() : null,
            }))}
            candidates={reviewers}
            canEdit={r.status === "in_progress"}
          />

          {actorAssignment && r.status === "in_progress" ? (
            <SubmitVerdictPanel
              reviewId={r.id}
              initialVerdict={actorAssignment.verdict ?? null}
              initialSummary={actorAssignment.summary ?? ""}
              alreadySubmitted={!!actorAssignment.submittedAt}
            />
          ) : null}

          {canClose ? (
            <CloseReviewPanel
              reviewId={r.id}
              overallVerdict={overallVerdict}
              initialSummary={r.summary}
            />
          ) : r.closedAt ? (
            <Panel title="Outcome">
              <div className="font-mono text-[11px] text-muted">
                Closed {new Date(r.closedAt).toLocaleDateString()}
              </div>
              {r.summary ? (
                <div className="mt-2 whitespace-pre-wrap font-mono text-[12px] text-text">
                  {r.summary}
                </div>
              ) : null}
            </Panel>
          ) : null}

          <ConsolidatedReport groups={groups} sectionNumbers={sectionNumbers} report={report} />
        </div>
      </div>
    </div>
  );
}
