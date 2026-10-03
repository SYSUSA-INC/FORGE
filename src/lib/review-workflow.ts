/**
 * BL-FB-X-COLOR-TEAM — colour-team review workflow against Postgres:
 * a reviewer's section scope and checklist ticks for one round. Rows
 * are scoped through review → proposal → organization like the other
 * review tables. Server-only; callers own auth.
 */
import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  proposalReviewAssignments,
  proposalReviewChecklistItems,
  proposalReviewSectionAssignments,
  proposalReviews,
  proposalSections,
  proposals,
} from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { CHECKLIST_LIMITS } from "@/lib/review-workflow-logic";

type Actor = { userId: string | null; email?: string | null };

async function loadOwnedReview(organizationId: string, reviewId: string) {
  const [row] = await db
    .select({
      id: proposalReviews.id,
      proposalId: proposalReviews.proposalId,
      status: proposalReviews.status,
      checklist: proposalReviews.checklist,
    })
    .from(proposalReviews)
    .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
    .where(and(eq(proposalReviews.id, reviewId), eq(proposals.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

async function isAssigned(reviewId: string, userId: string) {
  const [row] = await db
    .select({ userId: proposalReviewAssignments.userId })
    .from(proposalReviewAssignments)
    .where(and(eq(proposalReviewAssignments.reviewId, reviewId), eq(proposalReviewAssignments.userId, userId)))
    .limit(1);
  return !!row;
}

/** The section ids among `sectionIds` that belong to `proposalId`. */
export async function ownedSectionIds(organizationId: string, proposalId: string, sectionIds: readonly string[]): Promise<string[]> {
  if (sectionIds.length === 0) return [];
  const rows = await db
    .select({ id: proposalSections.id })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .where(
      and(
        eq(proposals.organizationId, organizationId),
        eq(proposalSections.proposalId, proposalId),
        inArray(proposalSections.id, [...sectionIds]),
      ),
    );
  return rows.map((r) => r.id);
}

export type SetSectionsResult = { ok: true; proposalId: string; sectionIds: string[] } | { ok: false; error: string };

/**
 * Scope one reviewer of a round to these sections (none = whole
 * proposal). Replaces the previous scope; mirrors the first section onto
 * the legacy single `section_id`; audited.
 */
export async function setReviewerSections(input: {
  organizationId: string;
  reviewId: string;
  userId: string;
  sectionIds: readonly string[];
  actor: Actor;
}): Promise<SetSectionsResult> {
  const { organizationId } = input;
  const review = await loadOwnedReview(organizationId, input.reviewId);
  if (!review) return { ok: false, error: "Review not found." };
  if (review.status !== "in_progress") return { ok: false, error: "This review is closed." };
  if (!(await isAssigned(review.id, input.userId))) return { ok: false, error: "That person is not a reviewer on this round." };

  const wanted = Array.from(new Set(input.sectionIds.filter((id) => typeof id === "string" && id.length > 0)));
  const valid = await ownedSectionIds(organizationId, review.proposalId, wanted);
  if (valid.length !== wanted.length) return { ok: false, error: "One or more sections do not belong to this proposal." };
  const sectionIds = wanted.filter((id) => valid.includes(id));

  await db
    .delete(proposalReviewSectionAssignments)
    .where(and(eq(proposalReviewSectionAssignments.reviewId, review.id), eq(proposalReviewSectionAssignments.userId, input.userId)));
  if (sectionIds.length > 0) {
    await db
      .insert(proposalReviewSectionAssignments)
      .values(sectionIds.map((sectionId) => ({ reviewId: review.id, userId: input.userId, sectionId })))
      .onConflictDoNothing();
  }
  await db
    .update(proposalReviewAssignments)
    .set({ sectionId: sectionIds[0] ?? null })
    .where(and(eq(proposalReviewAssignments.reviewId, review.id), eq(proposalReviewAssignments.userId, input.userId)));

  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "proposal.review.sections.set",
    resourceType: "proposal_review_assignment",
    resourceId: review.id,
    metadata: { reviewId: review.id, proposalId: review.proposalId, reviewerUserId: input.userId, sectionIds },
  });
  return { ok: true, proposalId: review.proposalId, sectionIds };
}

export type ChecklistTickResult = { ok: true; proposalId: string } | { ok: false; error: string };

/** One reviewer ticks (or clears) one line of the round's checklist, with an optional note; audited. */
export async function setChecklistItem(input: {
  organizationId: string;
  reviewId: string;
  userId: string;
  itemKey: string;
  checked: boolean;
  note?: string;
  actor: Actor;
}): Promise<ChecklistTickResult> {
  const { organizationId } = input;
  const review = await loadOwnedReview(organizationId, input.reviewId);
  if (!review) return { ok: false, error: "Review not found." };
  if (review.status !== "in_progress") return { ok: false, error: "This review is closed." };
  if (!review.checklist.some((item) => item.key === input.itemKey)) return { ok: false, error: "That checklist line is not part of this round." };
  if (!(await isAssigned(review.id, input.userId))) return { ok: false, error: "Only an assigned reviewer can tick the checklist." };

  const note = (input.note ?? "").trim().slice(0, CHECKLIST_LIMITS.maxNoteChars);
  await db
    .insert(proposalReviewChecklistItems)
    .values({ reviewId: review.id, userId: input.userId, itemKey: input.itemKey, checked: input.checked, note, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [proposalReviewChecklistItems.reviewId, proposalReviewChecklistItems.userId, proposalReviewChecklistItems.itemKey],
      set: { checked: input.checked, note, updatedAt: new Date() },
    });

  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "proposal.review.checklist.set",
    resourceType: "proposal_review",
    resourceId: review.id,
    metadata: { reviewId: review.id, proposalId: review.proposalId, itemKey: input.itemKey, checked: input.checked, hasNote: note.length > 0 },
  });
  return { ok: true, proposalId: review.proposalId };
}

export type ReviewWorkflowState = {
  sectionAssignments: { userId: string; sectionId: string }[];
  checklistStates: { userId: string; itemKey: string; checked: boolean; note: string }[];
};

/** Section scopes and checklist ticks of one round; empty for a round the organization does not own. */
export async function getReviewWorkflow(input: { organizationId: string; reviewId: string }): Promise<ReviewWorkflowState> {
  const { organizationId } = input;
  const review = await loadOwnedReview(organizationId, input.reviewId);
  if (!review) return { sectionAssignments: [], checklistStates: [] };
  const [sectionAssignments, checklistStates] = await Promise.all([
    db
      .select({ userId: proposalReviewSectionAssignments.userId, sectionId: proposalReviewSectionAssignments.sectionId })
      .from(proposalReviewSectionAssignments)
      .where(eq(proposalReviewSectionAssignments.reviewId, review.id)),
    db
      .select({
        userId: proposalReviewChecklistItems.userId,
        itemKey: proposalReviewChecklistItems.itemKey,
        checked: proposalReviewChecklistItems.checked,
        note: proposalReviewChecklistItems.note,
      })
      .from(proposalReviewChecklistItems)
      .where(eq(proposalReviewChecklistItems.reviewId, review.id)),
  ]);
  return { sectionAssignments, checklistStates };
}
