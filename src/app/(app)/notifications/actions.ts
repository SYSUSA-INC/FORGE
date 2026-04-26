"use server";

import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  notifications,
  users,
  type NotificationKind,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";

export type NotificationRow = {
  id: string;
  kind: NotificationKind;
  subject: string;
  body: string;
  linkPath: string;
  proposalId: string | null;
  reviewId: string | null;
  commentId: string | null;
  emailSentAt: string | null;
  emailError: string;
  readAt: string | null;
  createdAt: string;
  actorName: string | null;
  actorEmail: string | null;
};

export async function listMyNotificationsAction(
  options: { limit?: number; unreadOnly?: boolean } = {},
): Promise<NotificationRow[]> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const limit = Math.min(options.limit ?? 50, 200);

  const filters = [
    eq(notifications.recipientUserId, user.id),
    eq(notifications.organizationId, organizationId),
  ];
  if (options.unreadOnly) filters.push(isNull(notifications.readAt));

  const rows = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      subject: notifications.subject,
      body: notifications.body,
      linkPath: notifications.linkPath,
      proposalId: notifications.proposalId,
      reviewId: notifications.reviewId,
      commentId: notifications.commentId,
      emailSentAt: notifications.emailSentAt,
      emailError: notifications.emailError,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      actorName: users.name,
      actorEmail: users.email,
    })
    .from(notifications)
    .leftJoin(users, eq(users.id, notifications.actorUserId))
    .where(and(...filters))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    subject: r.subject,
    body: r.body,
    linkPath: r.linkPath,
    proposalId: r.proposalId,
    reviewId: r.reviewId,
    commentId: r.commentId,
    emailSentAt: r.emailSentAt ? r.emailSentAt.toISOString() : null,
    emailError: r.emailError,
    readAt: r.readAt ? r.readAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    actorName: r.actorName,
    actorEmail: r.actorEmail,
  }));
}

export async function getMyUnreadCount(): Promise<number> {
  const user = await requireAuth();
  if (!user.organizationId) return 0;
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.recipientUserId, user.id),
        eq(notifications.organizationId, user.organizationId),
        isNull(notifications.readAt),
      ),
    );
  return Number(row?.n ?? 0);
}

export async function markNotificationsReadAction(
  ids: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (ids.length === 0) return { ok: true };
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  try {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.recipientUserId, user.id),
          eq(notifications.organizationId, organizationId),
          inArray(notifications.id, ids),
          isNull(notifications.readAt),
        ),
      );
    revalidatePath("/notifications");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    console.error("[markNotificationsReadAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to mark read.",
    };
  }
}

export async function markAllNotificationsReadAction(): Promise<
  { ok: true; count: number } | { ok: false; error: string }
> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  try {
    const updated = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.recipientUserId, user.id),
          eq(notifications.organizationId, organizationId),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id });
    revalidatePath("/notifications");
    revalidatePath("/", "layout");
    return { ok: true, count: updated.length };
  } catch (err) {
    console.error("[markAllNotificationsReadAction]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to mark all read.",
    };
  }
}
