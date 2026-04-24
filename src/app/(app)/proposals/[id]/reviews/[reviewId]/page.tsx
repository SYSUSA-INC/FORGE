import Link from "next/link";
import { and, asc, desc, eq } from "drizzle-orm";
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
import { ReviewerList } from "./ReviewerList";
import { SubmitVerdictPanel } from "./SubmitVerdictPanel";
import { CommentsPanel } from "./CommentsPanel";
import { CloseReviewPanel } from "./CloseReviewPanel";
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
    })
    .from(proposalReviewComments)
    .leftJoin(users, eq(users.id, proposalReviewComments.userId))
    .where(eq(proposalReviewComments.reviewId, r.id))
    .orderBy(desc(proposalReviewComments.createdAt));

  const reviewers = await listOrgReviewers();
  const actorAssignment = assignmentRows.find((a) => a.userId === actor.id);
  const canClose = r.status === "in_progress";
  const overallVerdict = computeOverallVerdict(
    assignmentRows.map((a) => a.verdict ?? null),
  );

  const colorHex = REVIEW_COLOR_HEX[r.color];
  const statusColor = STATUS_COLORS[r.status];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
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
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2 flex flex-col gap-4">
          <CommentsPanel
            reviewId={r.id}
            proposalId={params.id}
            sections={sections}
            currentUserId={actor.id}
            isSuperadmin={actor.isSuperadmin}
            comments={commentRows.map((c) => ({
              id: c.id,
              sectionId: c.sectionId,
              userId: c.userId,
              body: c.body,
              resolved: c.resolved,
              createdAt: c.createdAt.toISOString(),
              authorName: c.authorName,
              authorEmail: c.authorEmail,
            }))}
          />
        </div>

        <div className="flex flex-col gap-4">
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
        </div>
      </div>
    </div>
  );
}
