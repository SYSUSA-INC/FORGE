import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  notifications,
  users,
  type NewNotification,
  type NotificationKind,
} from "@/db/schema";
import { sendReviewAssignedEmail } from "@/lib/email";
import { log } from "@/lib/log";

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
    log.error("[notifications.persist]", "error", { error: err });
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
    log.error("[notifications.markEmailResult]", "error", { error: err });
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

// BL-13 Phase E-2c left this dispatcher in place because the parallel
// `dispatchTriggerEvent({ kind: "review_request_pending" })` call exists
// only inside `startReviewAction` (initial fan-out via the
// `review_assignee` formula rule). `assignReviewerAction` adds a single
// reviewer later and has no equivalent trigger-event coverage — the
// `review_assignee` formula would over-notify by sending to all current
// reviewers on every add. Retiring this needs a new
// `review_assignment_added` trigger event kind + matching seed rule
// (Phase E-2d, tracked in BACKLOG).
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
    log.error("[dispatchReviewAssignedNotification]", "error", { error: err });
  }
}
