"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import {
  memberships,
  proposalReviewAssignments,
  proposalReviewComments,
  proposalReviews,
  proposalSections,
  proposals,
  users,
  type ReviewColor,
  type ReviewVerdict,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";

async function assertProposalOwned(proposalId: string, organizationId: string) {
  const [row] = await db
    .select({ id: proposals.id })
    .from(proposals)
    .where(
      and(
        eq(proposals.id, proposalId),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  return !!row;
}

async function assertReviewOwned(reviewId: string, organizationId: string) {
  const [row] = await db
    .select({ reviewId: proposalReviews.id })
    .from(proposalReviews)
    .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
    .where(
      and(
        eq(proposalReviews.id, reviewId),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  return !!row;
}

export async function startReviewAction(input: {
  proposalId: string;
  color: ReviewColor;
  dueDate?: string | null;
  reviewerUserIds: string[];
}): Promise<{ ok: true; reviewId: string } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await assertProposalOwned(input.proposalId, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }
  if (input.reviewerUserIds.length === 0) {
    return { ok: false, error: "Assign at least one reviewer." };
  }

  try {
    const [review] = await db
      .insert(proposalReviews)
      .values({
        proposalId: input.proposalId,
        color: input.color,
        status: "in_progress",
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        startedByUserId: actor.id,
        startedAt: new Date(),
      })
      .returning({ id: proposalReviews.id });
    if (!review) return { ok: false, error: "Could not create review." };

    await db.insert(proposalReviewAssignments).values(
      input.reviewerUserIds.map((uid) => ({
        reviewId: review.id,
        userId: uid,
      })),
    );

    revalidatePath(`/proposals/${input.proposalId}/reviews`);
    revalidatePath(`/proposals/${input.proposalId}`);
    return { ok: true, reviewId: review.id };
  } catch (err) {
    console.error("[startReviewAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Start failed.",
    };
  }
}

export async function startReviewAndGoAction(input: {
  proposalId: string;
  color: ReviewColor;
  dueDate?: string | null;
  reviewerUserIds: string[];
}): Promise<void> {
  const res = await startReviewAction(input);
  if (res.ok) {
    redirect(`/proposals/${input.proposalId}/reviews/${res.reviewId}`);
  }
  throw new Error(res.ok ? "unreachable" : res.error);
}

export async function submitReviewerVerdictAction(input: {
  reviewId: string;
  verdict: ReviewVerdict;
  summary: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await assertReviewOwned(input.reviewId, organizationId))) {
    return { ok: false, error: "Review not found." };
  }

  const [assignment] = await db
    .select()
    .from(proposalReviewAssignments)
    .where(
      and(
        eq(proposalReviewAssignments.reviewId, input.reviewId),
        eq(proposalReviewAssignments.userId, actor.id),
      ),
    )
    .limit(1);
  if (!assignment) {
    return { ok: false, error: "You are not assigned to this review." };
  }

  await db
    .update(proposalReviewAssignments)
    .set({
      verdict: input.verdict,
      summary: input.summary.trim(),
      submittedAt: new Date(),
    })
    .where(
      and(
        eq(proposalReviewAssignments.reviewId, input.reviewId),
        eq(proposalReviewAssignments.userId, actor.id),
      ),
    );

  const [review] = await db
    .select({ proposalId: proposalReviews.proposalId })
    .from(proposalReviews)
    .where(eq(proposalReviews.id, input.reviewId))
    .limit(1);
  if (review) {
    revalidatePath(`/proposals/${review.proposalId}/reviews/${input.reviewId}`);
    revalidatePath(`/proposals/${review.proposalId}/reviews`);
  }
  return { ok: true };
}

export async function closeReviewAction(input: {
  reviewId: string;
  verdict: ReviewVerdict;
  summary: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await assertReviewOwned(input.reviewId, organizationId))) {
    return { ok: false, error: "Review not found." };
  }

  const [review] = await db
    .select({ proposalId: proposalReviews.proposalId })
    .from(proposalReviews)
    .where(eq(proposalReviews.id, input.reviewId))
    .limit(1);

  await db
    .update(proposalReviews)
    .set({
      status: "complete",
      verdict: input.verdict,
      summary: input.summary.trim(),
      closedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(proposalReviews.id, input.reviewId));

  if (review) {
    revalidatePath(`/proposals/${review.proposalId}/reviews/${input.reviewId}`);
    revalidatePath(`/proposals/${review.proposalId}/reviews`);
    revalidatePath(`/proposals/${review.proposalId}`);
  }
  return { ok: true };
}

export async function cancelReviewAction(
  reviewId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await assertReviewOwned(reviewId, organizationId))) {
    return { ok: false, error: "Review not found." };
  }
  const [review] = await db
    .select({ proposalId: proposalReviews.proposalId })
    .from(proposalReviews)
    .where(eq(proposalReviews.id, reviewId))
    .limit(1);
  await db
    .update(proposalReviews)
    .set({ status: "cancelled", closedAt: new Date(), updatedAt: new Date() })
    .where(eq(proposalReviews.id, reviewId));
  if (review) {
    revalidatePath(`/proposals/${review.proposalId}/reviews`);
    revalidatePath(`/proposals/${review.proposalId}`);
  }
  return { ok: true };
}

export async function assignReviewerAction(input: {
  reviewId: string;
  userId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await assertReviewOwned(input.reviewId, organizationId))) {
    return { ok: false, error: "Review not found." };
  }
  const [existingMembership] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, input.userId),
        eq(memberships.organizationId, organizationId),
        eq(memberships.status, "active"),
      ),
    )
    .limit(1);
  if (!existingMembership) {
    return { ok: false, error: "User is not a member of this org." };
  }
  await db
    .insert(proposalReviewAssignments)
    .values({ reviewId: input.reviewId, userId: input.userId })
    .onConflictDoNothing();
  const [review] = await db
    .select({ proposalId: proposalReviews.proposalId })
    .from(proposalReviews)
    .where(eq(proposalReviews.id, input.reviewId))
    .limit(1);
  if (review) {
    revalidatePath(`/proposals/${review.proposalId}/reviews/${input.reviewId}`);
  }
  return { ok: true };
}

export async function unassignReviewerAction(input: {
  reviewId: string;
  userId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await assertReviewOwned(input.reviewId, organizationId))) {
    return { ok: false, error: "Review not found." };
  }
  await db
    .delete(proposalReviewAssignments)
    .where(
      and(
        eq(proposalReviewAssignments.reviewId, input.reviewId),
        eq(proposalReviewAssignments.userId, input.userId),
      ),
    );
  const [review] = await db
    .select({ proposalId: proposalReviews.proposalId })
    .from(proposalReviews)
    .where(eq(proposalReviews.id, input.reviewId))
    .limit(1);
  if (review) {
    revalidatePath(`/proposals/${review.proposalId}/reviews/${input.reviewId}`);
  }
  return { ok: true };
}

export async function addReviewCommentAction(input: {
  reviewId: string;
  sectionId?: string | null;
  body: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await assertReviewOwned(input.reviewId, organizationId))) {
    return { ok: false, error: "Review not found." };
  }
  if (!input.body.trim()) {
    return { ok: false, error: "Comment can't be empty." };
  }
  const [row] = await db
    .insert(proposalReviewComments)
    .values({
      reviewId: input.reviewId,
      sectionId: input.sectionId ?? null,
      userId: actor.id,
      body: input.body.trim(),
    })
    .returning({ id: proposalReviewComments.id });

  const [review] = await db
    .select({ proposalId: proposalReviews.proposalId })
    .from(proposalReviews)
    .where(eq(proposalReviews.id, input.reviewId))
    .limit(1);
  if (review) {
    revalidatePath(`/proposals/${review.proposalId}/reviews/${input.reviewId}`);
  }
  return { ok: true, id: row!.id };
}

export async function toggleCommentResolvedAction(input: {
  commentId: string;
  resolved: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const [row] = await db
    .select({
      id: proposalReviewComments.id,
      reviewId: proposalReviewComments.reviewId,
      proposalId: proposalReviews.proposalId,
    })
    .from(proposalReviewComments)
    .innerJoin(
      proposalReviews,
      eq(proposalReviews.id, proposalReviewComments.reviewId),
    )
    .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
    .where(
      and(
        eq(proposalReviewComments.id, input.commentId),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, error: "Comment not found." };
  await db
    .update(proposalReviewComments)
    .set({ resolved: input.resolved })
    .where(eq(proposalReviewComments.id, input.commentId));
  revalidatePath(`/proposals/${row.proposalId}/reviews/${row.reviewId}`);
  return { ok: true };
}

export async function deleteReviewCommentAction(
  commentId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const [row] = await db
    .select({
      id: proposalReviewComments.id,
      userId: proposalReviewComments.userId,
      reviewId: proposalReviewComments.reviewId,
      proposalId: proposalReviews.proposalId,
    })
    .from(proposalReviewComments)
    .innerJoin(
      proposalReviews,
      eq(proposalReviews.id, proposalReviewComments.reviewId),
    )
    .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
    .where(
      and(
        eq(proposalReviewComments.id, commentId),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!row) return { ok: false, error: "Comment not found." };
  if (row.userId !== actor.id && !actor.isSuperadmin) {
    return { ok: false, error: "Only the author or a superadmin can delete." };
  }
  await db
    .delete(proposalReviewComments)
    .where(eq(proposalReviewComments.id, commentId));
  revalidatePath(`/proposals/${row.proposalId}/reviews/${row.reviewId}`);
  return { ok: true };
}

export async function listOrgReviewers() {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.status, "active"),
      ),
    );
}

export async function listProposalSectionsForReview(proposalId: string) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await assertProposalOwned(proposalId, organizationId))) {
    return [];
  }
  return db
    .select({
      id: proposalSections.id,
      title: proposalSections.title,
      ordering: proposalSections.ordering,
    })
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, proposalId))
    .orderBy(proposalSections.ordering);
}

export async function listReviewsForProposal(proposalId: string) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await assertProposalOwned(proposalId, organizationId))) {
    return { reviews: [], assignments: [] };
  }

  const reviews = await db
    .select()
    .from(proposalReviews)
    .where(eq(proposalReviews.proposalId, proposalId))
    .orderBy(desc(proposalReviews.createdAt));

  const reviewIds = reviews.map((r) => r.id);
  const assignments =
    reviewIds.length === 0
      ? []
      : await db
          .select({
            reviewId: proposalReviewAssignments.reviewId,
            userId: proposalReviewAssignments.userId,
            verdict: proposalReviewAssignments.verdict,
            submittedAt: proposalReviewAssignments.submittedAt,
            name: users.name,
            email: users.email,
          })
          .from(proposalReviewAssignments)
          .leftJoin(users, eq(users.id, proposalReviewAssignments.userId))
          .where(inArray(proposalReviewAssignments.reviewId, reviewIds));

  return { reviews, assignments };
}
