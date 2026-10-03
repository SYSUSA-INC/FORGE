"use server";

import { and, count, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import {
  memberships,
  proposalReviewAssignments,
  proposalReviewComments,
  proposalReviewSectionAssignments,
  proposalReviews,
  proposalSections,
  proposals,
  users,
  type ReviewColor,
  type ReviewVerdict,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { runInBackground } from "@/lib/background";
import { extractMentionUserIds } from "@/lib/mentions";
import { dispatchTriggerEvent } from "@/lib/notification-dispatcher";
import { runReviewPreflight } from "@/lib/review-preflight";
import { summarizeReview, type SummarizeReviewResult } from "@/lib/review-summary";
import { carryOpenComments, setChecklistItem, setReviewerSections } from "@/lib/review-workflow";
import { CHECKLIST_LIMITS, REVIEW_CHECKLIST_TEMPLATES, sanitizeChecklist } from "@/lib/review-workflow-logic";
import { setReviewCommentResolved } from "@/lib/section-review-comments";
import { log } from "@/lib/log";

const COLOR_LABELS: Record<ReviewColor, string> = {
  pink: "Pink Team",
  red: "Red Team",
  gold: "Gold Team",
  white_gloves: "White Gloves",
  green: "Green Team",
};

const VERDICT_LABELS: Record<ReviewVerdict, string> = {
  pass: "Pass",
  conditional: "Conditional",
  fail: "Fail",
};

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
  /**
   * Optional per-reviewer section scope, keyed by user id: one section
   * (older callers) or several (BL-FB-X-COLOR-TEAM); null / empty =
   * the whole proposal.
   */
  sectionAssignments?: Record<string, string | string[] | null>;
  /** BL-FB-X-COLOR-TEAM — the lead's charge to the reviewers. */
  instructions?: string;
  /** BL-FB-X-COLOR-TEAM — the checklist for this round; the colour's template when omitted. */
  checklist?: unknown;
  /** BL-FB-X-COLOR-TEAM Slice 2 — an earlier round of this proposal whose open comments move into the new one. */
  carryFromReviewId?: string | null;
}): Promise<{ ok: true; reviewId: string } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await assertProposalOwned(input.proposalId, organizationId))) {
    return { ok: false, error: "Proposal not found." };
  }
  if (input.reviewerUserIds.length === 0) {
    return { ok: false, error: "Assign at least one reviewer." };
  }

  const scopeByUser = new Map<string, string[]>();
  for (const [uid, scope] of Object.entries(input.sectionAssignments ?? {})) {
    const ids = (Array.isArray(scope) ? scope : [scope]).filter((id): id is string => typeof id === "string" && id.length > 0);
    if (ids.length > 0) scopeByUser.set(uid, Array.from(new Set(ids)));
  }

  // Validate any per-reviewer section assignments belong to this proposal
  // — prevents injecting section ids from another org's proposal.
  const requestedSectionIds = Array.from(new Set(Array.from(scopeByUser.values()).flat()));
  if (requestedSectionIds.length > 0) {
    const validSections = await db
      .select({ id: proposalSections.id })
      .from(proposalSections)
      .where(
        and(
          eq(proposalSections.proposalId, input.proposalId),
          inArray(proposalSections.id, requestedSectionIds),
        ),
      );
    if (validSections.length !== requestedSectionIds.length) {
      return {
        ok: false,
        error: "One or more assigned sections do not belong to this proposal.",
      };
    }
  }

  const checklist = sanitizeChecklist(input.checklist) ?? REVIEW_CHECKLIST_TEMPLATES[input.color];
  const instructions = (input.instructions ?? "").trim().slice(0, CHECKLIST_LIMITS.maxInstructionsChars);

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
        instructions,
        checklist,
      })
      .returning({ id: proposalReviews.id });
    if (!review) return { ok: false, error: "Could not create review." };

    const assignmentRows = input.reviewerUserIds.map((uid) => ({
      reviewId: review.id,
      userId: uid,
      // The legacy single scope mirrors the first of the reviewer's sections.
      sectionId: scopeByUser.get(uid)?.[0] ?? null,
    }));
    await db.insert(proposalReviewAssignments).values(assignmentRows);
    const scopeRows = input.reviewerUserIds.flatMap((uid) =>
      (scopeByUser.get(uid) ?? []).map((sectionId) => ({ reviewId: review.id, userId: uid, sectionId })),
    );
    if (scopeRows.length > 0) {
      await db.insert(proposalReviewSectionAssignments).values(scopeRows).onConflictDoNothing();
    }

    // Slice 2 — the previous round's open comments open this one. A
    // refusal (wrong proposal, foreign round) is logged, never fatal:
    // the round exists and the lead sees the comments did not arrive.
    let carried = 0;
    if (input.carryFromReviewId) {
      const res = await carryOpenComments({
        organizationId,
        fromReviewId: input.carryFromReviewId,
        toReviewId: review.id,
        actor: { userId: actor.id, email: actor.email },
      });
      if (res.ok) carried = res.carried;
      else log.warn("[startReviewAction]", "carry-forward refused", { reviewId: review.id, error: res.error });
    }

    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "proposal.review.start",
      resourceType: "proposal_review",
      resourceId: review.id,
      metadata: {
        proposalId: input.proposalId,
        color: input.color,
        reviewerCount: input.reviewerUserIds.length,
        carriedFromReviewId: input.carryFromReviewId ?? null,
        carried,
      },
    });

    // BL-13 — fire the rules engine.
    await dispatchTriggerEvent({
      organizationId,
      kind: "review_request_pending",
      payload: {
        proposalId: input.proposalId,
        reviewId: review.id,
        color: input.color,
      },
      subject: `${input.color} review started`,
      linkPath: `/proposals/${input.proposalId}/reviews/${review.id}`,
      proposalId: input.proposalId,
      reviewId: review.id,
      actorUserId: actor.id,
    });

    // BL-AIP-6 — AI colour-team pre-review: each section is read against
    // its mapped requirements and the win themes, and the findings land
    // as FORGE AI review comments before the human reviewers open it.
    // Feature- and quota-gated inside; never blocks the start.
    const reviewId = review.id;
    runInBackground("[startReviewAction] AI pre-review", () =>
      runReviewPreflight({
        organizationId,
        proposalId: input.proposalId,
        reviewId,
        color: input.color,
        actor: { id: actor.id, email: actor.email },
      }),
    );

    revalidatePath(`/proposals/${input.proposalId}/reviews`);
    revalidatePath(`/proposals/${input.proposalId}`);
    revalidatePath("/");
    return { ok: true, reviewId: review.id };
  } catch (err) {
    log.error("[startReviewAction]", "error", { error: err });
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

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "proposal.review.verdict_submit",
    resourceType: "proposal_review_assignment",
    resourceId: input.reviewId,
    metadata: { reviewId: input.reviewId, verdict: input.verdict },
  });

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
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  if (!(await assertReviewOwned(input.reviewId, organizationId))) {
    return { ok: false, error: "Review not found." };
  }

  const [review] = await db
    .select({
      proposalId: proposalReviews.proposalId,
      color: proposalReviews.color,
      proposalTitle: proposals.title,
      proposalManagerUserId: proposals.proposalManagerUserId,
    })
    .from(proposalReviews)
    .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
    .where(eq(proposalReviews.id, input.reviewId))
    .limit(1);

  const summary = input.summary.trim();

  await db
    .update(proposalReviews)
    .set({
      status: "complete",
      verdict: input.verdict,
      summary,
      closedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(proposalReviews.id, input.reviewId));

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "proposal.review.close",
    resourceType: "proposal_review",
    resourceId: input.reviewId,
    metadata: {
      proposalId: review?.proposalId,
      verdict: input.verdict,
    },
  });

  if (review) {
    // BL-13 — fire the rules engine. Default seeded rules
    // (`review_completed`) deliver to assigned reviewers + proposal
    // manager via the `review_assignee` and `proposal_owner` formulas.
    await dispatchTriggerEvent({
      organizationId,
      kind: "review_completed",
      payload: {
        proposalId: review.proposalId,
        reviewId: input.reviewId,
        verdict: input.verdict,
        color: review.color,
      },
      subject: `${COLOR_LABELS[review.color]} review closed — ${VERDICT_LABELS[input.verdict]}`,
      body: summary,
      linkPath: `/proposals/${review.proposalId}/reviews/${input.reviewId}`,
      proposalId: review.proposalId,
      reviewId: input.reviewId,
      actorUserId: actor.id,
    });

    revalidatePath(`/proposals/${review.proposalId}/reviews/${input.reviewId}`);
    revalidatePath(`/proposals/${review.proposalId}/reviews`);
    revalidatePath(`/proposals/${review.proposalId}`);
    revalidatePath("/");
  }
  return { ok: true };
}

export async function cancelReviewAction(
  reviewId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
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
  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "proposal.review.cancel",
    resourceType: "proposal_review",
    resourceId: reviewId,
    metadata: { proposalId: review?.proposalId },
  });
  if (review) {
    revalidatePath(`/proposals/${review.proposalId}/reviews`);
    revalidatePath(`/proposals/${review.proposalId}`);
    revalidatePath("/");
  }
  return { ok: true };
}

export async function assignReviewerAction(input: {
  reviewId: string;
  userId: string;
  sectionId?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
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
    .values({
      reviewId: input.reviewId,
      userId: input.userId,
      sectionId: input.sectionId ?? null,
    })
    .onConflictDoNothing();
  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "proposal.review.assign",
    resourceType: "proposal_review_assignment",
    resourceId: input.reviewId,
    metadata: {
      reviewId: input.reviewId,
      assignedUserId: input.userId,
      sectionId: input.sectionId ?? null,
    },
  });
  const [review] = await db
    .select({
      proposalId: proposalReviews.proposalId,
      color: proposalReviews.color,
      dueDate: proposalReviews.dueDate,
    })
    .from(proposalReviews)
    .where(eq(proposalReviews.id, input.reviewId))
    .limit(1);
  if (review) {
    // BL-13 Phase E-2d — fire the rules engine. Default seeded rule
    // (`review_assignment_added`) uses `mentioned_in_payload` so only
    // the newly-assigned user is notified — distinct from the initial
    // fan-out at review start, which uses `review_request_pending`
    // with the `review_assignee` formula (notifies all current
    // assignees).
    await dispatchTriggerEvent({
      organizationId,
      kind: "review_assignment_added",
      payload: {
        proposalId: review.proposalId,
        reviewId: input.reviewId,
        color: review.color,
        addedUserId: input.userId,
        sectionId: input.sectionId ?? null,
        mentionedUserIds: [input.userId],
      },
      subject: `${review.color} review — you've been added`,
      linkPath: `/proposals/${review.proposalId}/reviews/${input.reviewId}`,
      proposalId: review.proposalId,
      reviewId: input.reviewId,
      actorUserId: actor.id,
    });
    revalidatePath(`/proposals/${review.proposalId}/reviews/${input.reviewId}`);
  }
  return { ok: true };
}

export async function unassignReviewerAction(input: {
  reviewId: string;
  userId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
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
  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "proposal.review.unassign",
    resourceType: "proposal_review_assignment",
    resourceId: input.reviewId,
    metadata: { reviewId: input.reviewId, removedUserId: input.userId },
  });
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

/** BL-FB-X-COLOR-TEAM — scope one reviewer of the round to these sections (none = whole proposal). */
export async function setReviewerSectionsAction(input: {
  reviewId: string;
  userId: string;
  sectionIds: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const res = await setReviewerSections({
    organizationId,
    reviewId: input.reviewId,
    userId: input.userId,
    sectionIds: input.sectionIds,
    actor: { userId: actor.id, email: actor.email },
  });
  if (!res.ok) return res;
  revalidatePath(`/proposals/${res.proposalId}/reviews/${input.reviewId}`);
  revalidatePath(`/proposals/${res.proposalId}/sections`);
  return { ok: true };
}

/** BL-FB-X-COLOR-TEAM — the signed-in reviewer ticks or clears one checklist line, with an optional note. */
export async function setChecklistItemAction(input: {
  reviewId: string;
  itemKey: string;
  checked: boolean;
  note?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const res = await setChecklistItem({
    organizationId,
    reviewId: input.reviewId,
    userId: actor.id,
    itemKey: input.itemKey,
    checked: input.checked,
    note: input.note,
    actor: { userId: actor.id, email: actor.email },
  });
  if (!res.ok) return res;
  revalidatePath(`/proposals/${res.proposalId}/reviews/${input.reviewId}`);
  return { ok: true };
}

/** BL-FB-X-COLOR-TEAM Slice 2 — the AI debrief of this round, stored on it. */
export async function summarizeReviewAction(input: { reviewId: string }): Promise<SummarizeReviewResult> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const res = await summarizeReview({ organizationId, reviewId: input.reviewId, actor: { userId: actor.id, email: actor.email } });
  if (res.ok) {
    const [review] = await db.select({ proposalId: proposalReviews.proposalId }).from(proposalReviews).where(eq(proposalReviews.id, input.reviewId)).limit(1);
    if (review) revalidatePath(`/proposals/${review.proposalId}/reviews/${input.reviewId}`);
  }
  return res;
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
  const trimmedBody = input.body.trim();
  const [row] = await db
    .insert(proposalReviewComments)
    .values({
      reviewId: input.reviewId,
      sectionId: input.sectionId ?? null,
      userId: actor.id,
      body: trimmedBody,
    })
    .returning({ id: proposalReviewComments.id });

  if (row) {
    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "proposal.review.comment",
      resourceType: "proposal_review_comment",
      resourceId: row.id,
      metadata: {
        reviewId: input.reviewId,
        sectionId: input.sectionId ?? null,
        length: trimmedBody.length,
      },
    });
  }

  const [review] = await db
    .select({
      proposalId: proposalReviews.proposalId,
      color: proposalReviews.color,
      proposalTitle: proposals.title,
    })
    .from(proposalReviews)
    .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
    .where(eq(proposalReviews.id, input.reviewId))
    .limit(1);

  if (review && row) {
    const mentionedIds = extractMentionUserIds(trimmedBody).filter(
      (id) => id !== actor.id,
    );
    if (mentionedIds.length > 0) {
      const validMembers = await db
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            eq(memberships.status, "active"),
            inArray(memberships.userId, mentionedIds),
          ),
        );
      const validIds = validMembers.map((m) => m.userId);

      const [actorRow] = await db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, actor.id))
        .limit(1);
      const authorName =
        actorRow?.name ?? actorRow?.email ?? "A teammate";

      // BL-13 — fire the rules engine. Default seeded rule
      // (`comment_mentioned`) delivers to every @-mentioned user via
      // the `mentioned_in_payload` recipient strategy.
      await dispatchTriggerEvent({
        organizationId,
        kind: "comment_mentioned",
        payload: {
          proposalId: review.proposalId,
          reviewId: input.reviewId,
          commentId: row.id,
          color: review.color,
          mentionedUserIds: validIds,
        },
        subject: `${authorName} mentioned you in a ${COLOR_LABELS[review.color]} review comment`,
        body: trimmedBody.slice(0, 500),
        linkPath: `/proposals/${review.proposalId}/reviews/${input.reviewId}#comment-${row.id}`,
        proposalId: review.proposalId,
        reviewId: input.reviewId,
        commentId: row.id,
        actorUserId: actor.id,
      });
    }

    revalidatePath(`/proposals/${review.proposalId}/reviews/${input.reviewId}`);
  }
  return { ok: true, id: row!.id };
}

export async function toggleCommentResolvedAction(input: {
  commentId: string;
  resolved: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  // BL-AIP-6b — shared with the editor's Resolve (src/lib/section-review-comments.ts).
  const res = await setReviewCommentResolved({
    organizationId,
    commentId: input.commentId,
    resolved: input.resolved,
    actor: { userId: actor.id, email: actor.email },
    via: "review",
  });
  if (!res.ok) return res;
  revalidatePath(`/proposals/${res.proposalId}/reviews/${res.reviewId}`);
  revalidatePath(`/proposals/${res.proposalId}/sections`);
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
  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "proposal.review.comment.delete",
    resourceType: "proposal_review_comment",
    resourceId: commentId,
    metadata: { reviewId: row.reviewId, proposalId: row.proposalId },
  });
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
    return { reviews: [], assignments: [], openComments: {} as Record<string, number> };
  }

  const reviews = await db
    .select()
    .from(proposalReviews)
    .where(eq(proposalReviews.proposalId, proposalId))
    .orderBy(desc(proposalReviews.createdAt));

  const reviewIds = reviews.map((r) => r.id);
  // Slice 2 — open comments per round, so the start form can offer to carry them.
  const openRows =
    reviewIds.length === 0
      ? []
      : await db
          .select({ reviewId: proposalReviewComments.reviewId, n: count() })
          .from(proposalReviewComments)
          .where(and(inArray(proposalReviewComments.reviewId, reviewIds), eq(proposalReviewComments.resolved, false)))
          .groupBy(proposalReviewComments.reviewId);
  const openComments = Object.fromEntries(openRows.map((r) => [r.reviewId, Number(r.n)] as const));
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

  return { reviews, assignments, openComments };
}
