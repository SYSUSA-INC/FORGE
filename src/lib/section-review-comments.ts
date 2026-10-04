/**
 * BL-AIP-6b — open colour-team review comments per section, for the
 * editor, and the resolve that both the review page and the editor use.
 * Comments are scoped through review → proposal → organization. Server-
 * only; callers own auth.
 */
import "server-only";

import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { proposalReviewComments, proposalReviews, proposals, users } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { groupBySection, type SectionReviewComment } from "@/lib/review-comments";

const MAX_COMMENTS = 200;

export async function listOpenReviewCommentsBySection(input: {
  organizationId: string;
  proposalId: string;
}): Promise<Record<string, SectionReviewComment[]>> {
  const { organizationId } = input;
  const rows = await db
    .select({
      id: proposalReviewComments.id,
      reviewId: proposalReviewComments.reviewId,
      sectionId: proposalReviewComments.sectionId,
      color: proposalReviews.color,
      body: proposalReviewComments.body,
      userId: proposalReviewComments.userId,
      authorName: users.name,
      authorEmail: users.email,
      createdAt: proposalReviewComments.createdAt,
      carriedFromCommentId: proposalReviewComments.carriedFromCommentId,
    })
    .from(proposalReviewComments)
    .innerJoin(proposalReviews, eq(proposalReviews.id, proposalReviewComments.reviewId))
    .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
    .leftJoin(users, eq(users.id, proposalReviewComments.userId))
    .where(
      and(
        eq(proposals.organizationId, organizationId),
        eq(proposalReviews.proposalId, input.proposalId),
        eq(proposalReviewComments.resolved, false),
        isNotNull(proposalReviewComments.sectionId),
      ),
    )
    .orderBy(asc(proposalReviewComments.createdAt), asc(proposalReviewComments.id))
    .limit(MAX_COMMENTS);

  // BL-FB-X-COLOR-TEAM Slice 3 — where a carried comment came from: the
  // round (and colour) of the original, so the editor can say so.
  const originIds = Array.from(new Set(rows.map((r) => r.carriedFromCommentId).filter((id): id is string => !!id)));
  const origins = new Map<string, { reviewId: string; color: SectionReviewComment["color"] }>();
  if (originIds.length > 0) {
    const originRows = await db
      .select({ id: proposalReviewComments.id, reviewId: proposalReviewComments.reviewId, color: proposalReviews.color })
      .from(proposalReviewComments)
      .innerJoin(proposalReviews, eq(proposalReviews.id, proposalReviewComments.reviewId))
      .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
      .where(and(eq(proposals.organizationId, organizationId), inArray(proposalReviewComments.id, originIds)));
    for (const o of originRows) origins.set(o.id, { reviewId: o.reviewId, color: o.color });
  }

  return groupBySection(
    rows.map<SectionReviewComment>((r) => ({
      id: r.id,
      reviewId: r.reviewId,
      sectionId: r.sectionId!,
      color: r.color,
      body: r.body,
      authorName: r.userId ? r.authorName || r.authorEmail || "Reviewer" : null,
      createdAt: r.createdAt.toISOString(),
      carriedFrom: r.carriedFromCommentId ? (origins.get(r.carriedFromCommentId) ?? null) : null,
    })),
  );
}

export type ResolveResult = { ok: true; proposalId: string; reviewId: string } | { ok: false; error: string };

/** Resolve (or reopen) one comment of the organization's; audited. */
export async function setReviewCommentResolved(input: {
  organizationId: string;
  commentId: string;
  resolved: boolean;
  actor: { userId: string | null; email?: string | null };
  via: "review" | "editor";
}): Promise<ResolveResult> {
  const { organizationId } = input;
  const [row] = await db
    .select({
      id: proposalReviewComments.id,
      reviewId: proposalReviewComments.reviewId,
      proposalId: proposalReviews.proposalId,
    })
    .from(proposalReviewComments)
    .innerJoin(proposalReviews, eq(proposalReviews.id, proposalReviewComments.reviewId))
    .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
    .where(and(eq(proposalReviewComments.id, input.commentId), eq(proposals.organizationId, organizationId)))
    .limit(1);
  if (!row) return { ok: false, error: "Comment not found." };

  await db
    .update(proposalReviewComments)
    .set({ resolved: input.resolved })
    .where(eq(proposalReviewComments.id, row.id));

  await recordAudit({
    organizationId,
    actor: input.actor,
    action: input.resolved ? "proposal.review.comment.resolve" : "proposal.review.comment.unresolve",
    resourceType: "proposal_review_comment",
    resourceId: row.id,
    metadata: { reviewId: row.reviewId, proposalId: row.proposalId, via: input.via },
  });
  return { ok: true, proposalId: row.proposalId, reviewId: row.reviewId };
}
