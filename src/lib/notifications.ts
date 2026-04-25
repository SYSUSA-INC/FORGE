import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  notifications,
  users,
  type NewNotification,
  type NotificationKind,
} from "@/db/schema";
import {
  sendCommentMentionEmail,
  sendReviewAssignedEmail,
  sendReviewCompletedEmail,
} from "@/lib/email";

type DispatchInput = {
  kind: NotificationKind;
  organizationId: string;
  recipientUserId: string;
  actorUserId?: string | null;
  subject: string;
  body?: string;
  linkPath?: string;
  proposalId?: string | null;
  reviewId?: string | null;
  commentId?: string | null;
};

/**
 * Persist a notification row and return its id without sending email.
 * Use this when the call site wants to send email itself with
 * provider-specific args.
 */
async function persist(input: DispatchInput): Promise<string | null> {
  try {
    const payload: NewNotification = {
      organizationId: input.organizationId,
      recipientUserId: input.recipientUserId,
      actorUserId: input.actorUserId ?? null,
      kind: input.kind,
      subject: input.subject,
      body: input.body ?? "",
      linkPath: input.linkPath ?? "",
      proposalId: input.proposalId ?? null,
      reviewId: input.reviewId ?? null,
      commentId: input.commentId ?? null,
    };
    const [row] = await db
      .insert(notifications)
      .values(payload)
      .returning({ id: notifications.id });
    return row?.id ?? null;
  } catch (err) {
    console.error("[notifications.persist]", err);
    return null;
  }
}

async function markEmailResult(
  id: string,
  result: { ok: true } | { ok: false; error: string },
): Promise<void> {
  try {
    if (result.ok) {
      await db
        .update(notifications)
        .set({ emailSentAt: new Date() })
        .where(eq(notifications.id, id));
    } else {
      await db
        .update(notifications)
        .set({ emailError: result.error.slice(0, 500) })
        .where(eq(notifications.id, id));
    }
  } catch (err) {
    console.error("[notifications.markEmailResult]", err);
  }
}

async function getRecipient(userId: string): Promise<{
  email: string | null;
  name: string | null;
} | null> {
  const [row] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

export async function dispatchReviewAssignedNotification(input: {
  organizationId: string;
  actorUserId: string;
  recipientUserId: string;
  proposalId: string;
  proposalTitle: string;
  reviewId: string;
  reviewColor: string;
  starterName: string;
  dueDate: Date | null;
  sectionTitle: string | null;
}): Promise<void> {
  const recipient = await getRecipient(input.recipientUserId);
  if (!recipient?.email) return;

  const linkPath = `/proposals/${input.proposalId}/reviews/${input.reviewId}`;
  const subject = `${input.reviewColor} review on ${input.proposalTitle}`;
  const body = input.sectionTitle
    ? `Assigned to ${input.sectionTitle}.`
    : "You're a reviewer on this round.";

  const id = await persist({
    kind: input.sectionTitle ? "review_section_assigned" : "review_assigned",
    organizationId: input.organizationId,
    recipientUserId: input.recipientUserId,
    actorUserId: input.actorUserId,
    subject,
    body,
    linkPath,
    proposalId: input.proposalId,
    reviewId: input.reviewId,
  });

  try {
    await sendReviewAssignedEmail({
      to: recipient.email,
      recipientName: recipient.name,
      starterName: input.starterName,
      proposalTitle: input.proposalTitle,
      reviewColor: input.reviewColor,
      proposalId: input.proposalId,
      reviewId: input.reviewId,
      dueDate: input.dueDate,
      sectionTitle: input.sectionTitle,
    });
    if (id) await markEmailResult(id, { ok: true });
  } catch (err) {
    if (id)
      await markEmailResult(id, {
        ok: false,
        error: err instanceof Error ? err.message : "send failed",
      });
    console.error("[dispatchReviewAssignedNotification]", err);
  }
}

export async function dispatchCommentMentionNotification(input: {
  organizationId: string;
  actorUserId: string;
  authorName: string;
  recipientUserId: string;
  proposalId: string;
  proposalTitle: string;
  reviewId: string;
  reviewColor: string;
  commentId: string;
  commentBody: string;
  sectionTitle: string | null;
}): Promise<void> {
  const recipient = await getRecipient(input.recipientUserId);
  if (!recipient?.email) return;

  const linkPath = `/proposals/${input.proposalId}/reviews/${input.reviewId}`;
  const subject = `${input.authorName} mentioned you on ${input.proposalTitle}`;
  const body = input.commentBody.slice(0, 240);

  const id = await persist({
    kind: "review_comment_mentioned",
    organizationId: input.organizationId,
    recipientUserId: input.recipientUserId,
    actorUserId: input.actorUserId,
    subject,
    body,
    linkPath,
    proposalId: input.proposalId,
    reviewId: input.reviewId,
    commentId: input.commentId,
  });

  try {
    await sendCommentMentionEmail({
      to: recipient.email,
      authorName: input.authorName,
      proposalTitle: input.proposalTitle,
      reviewColor: input.reviewColor,
      commentBody: input.commentBody,
      sectionTitle: input.sectionTitle,
      proposalId: input.proposalId,
      reviewId: input.reviewId,
    });
    if (id) await markEmailResult(id, { ok: true });
  } catch (err) {
    if (id)
      await markEmailResult(id, {
        ok: false,
        error: err instanceof Error ? err.message : "send failed",
      });
    console.error("[dispatchCommentMentionNotification]", err);
  }
}

export async function dispatchReviewCompletedNotification(input: {
  organizationId: string;
  actorUserId: string;
  closerName: string;
  recipientUserId: string;
  proposalId: string;
  proposalTitle: string;
  reviewId: string;
  reviewColor: string;
  verdict: string;
  summary: string;
}): Promise<void> {
  const recipient = await getRecipient(input.recipientUserId);
  if (!recipient?.email) return;

  const linkPath = `/proposals/${input.proposalId}/reviews/${input.reviewId}`;
  const subject = `${input.reviewColor} review closed — ${input.verdict}`;
  const body = input.summary.slice(0, 240);

  const id = await persist({
    kind: "review_completed",
    organizationId: input.organizationId,
    recipientUserId: input.recipientUserId,
    actorUserId: input.actorUserId,
    subject,
    body,
    linkPath,
    proposalId: input.proposalId,
    reviewId: input.reviewId,
  });

  try {
    await sendReviewCompletedEmail({
      to: recipient.email,
      closerName: input.closerName,
      proposalTitle: input.proposalTitle,
      reviewColor: input.reviewColor,
      verdict: input.verdict,
      summary: input.summary,
      proposalId: input.proposalId,
      reviewId: input.reviewId,
    });
    if (id) await markEmailResult(id, { ok: true });
  } catch (err) {
    if (id)
      await markEmailResult(id, {
        ok: false,
        error: err instanceof Error ? err.message : "send failed",
      });
    console.error("[dispatchReviewCompletedNotification]", err);
  }
}
