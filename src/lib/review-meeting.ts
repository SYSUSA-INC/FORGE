/**
 * BL-NAV-LIFECYCLE 5c — a review round's meeting against Postgres: set or
 * clear the pasted link and start time, send the calendar invites, and
 * send the day-before reminder. FORGE creates no meeting itself. Every
 * read and write goes review → proposal → organization, so another
 * tenant's round is "not found". Server-only; callers own auth.
 */
import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  proposalReviewAssignments,
  proposalReviewSectionAssignments,
  proposalReviews,
  proposalSections,
  proposals,
  users,
} from "@/db/schema";
import { appBaseUrl } from "@/lib/app-url";
import { recordAudit } from "@/lib/audit-log";
import { sendReviewMeetingEmail } from "@/lib/email";
import { log } from "@/lib/log";
import { buildIcs, parseMeetingTime, parseMeetingUrl } from "@/lib/review-meeting-logic";
import { REVIEW_COLOR_LABELS } from "@/lib/review-types";

type Actor = { userId: string | null; email?: string | null };

export type ReviewMeeting = {
  reviewId: string;
  proposalId: string;
  url: string | null;
  at: Date | null;
  invitesSentAt: Date | null;
  reminderSentAt: Date | null;
};

/** The round's meeting, or null when the round is not this tenant's. */
export async function getReviewMeeting(organizationId: string, reviewId: string): Promise<ReviewMeeting | null> {
  const [row] = await db
    .select({
      reviewId: proposalReviews.id,
      proposalId: proposalReviews.proposalId,
      url: proposalReviews.meetingUrl,
      at: proposalReviews.meetingAt,
      invitesSentAt: proposalReviews.meetingInvitesSentAt,
      reminderSentAt: proposalReviews.meetingReminderSentAt,
    })
    .from(proposalReviews)
    .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
    .where(and(eq(proposalReviews.id, reviewId), eq(proposals.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

export type SetMeetingResult = { ok: true; proposalId: string } | { ok: false; error: string };

/** Set or clear the link and time. Blank clears. A moved time earns a fresh reminder. */
export async function setReviewMeeting(input: {
  organizationId: string;
  reviewId: string;
  url: string | null | undefined;
  at: string | null | undefined;
  actor: Actor;
}): Promise<SetMeetingResult> {
  const url = parseMeetingUrl(input.url);
  if (!url.ok) return url;
  const at = parseMeetingTime(input.at);
  if (!at.ok) return at;
  const current = await getReviewMeeting(input.organizationId, input.reviewId);
  if (!current) return { ok: false, error: "Review not found." };
  const [round] = await db
    .select({ status: proposalReviews.status })
    .from(proposalReviews)
    .where(eq(proposalReviews.id, input.reviewId))
    .limit(1);
  if (round && (round.status === "complete" || round.status === "cancelled")) {
    return { ok: false, error: "This round is closed, so its meeting can no longer be changed." };
  }
  const moved = (current.at?.getTime() ?? null) !== (at.at?.getTime() ?? null) || current.url !== url.url;
  await db
    .update(proposalReviews)
    .set({
      meetingUrl: url.url,
      meetingAt: at.at,
      ...(moved ? { meetingReminderSentAt: null } : {}),
      ...(!url.url || !at.at ? { meetingInvitesSentAt: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(proposalReviews.id, input.reviewId));
  await recordAudit({
    organizationId: input.organizationId,
    actor: { userId: input.actor.userId, email: input.actor.email },
    action: url.url || at.at ? "proposal.review.meeting_set" : "proposal.review.meeting_cleared",
    resourceType: "proposal_review",
    resourceId: input.reviewId,
    metadata: { hasLink: !!url.url, meetingAt: at.at ? at.at.toISOString() : null },
  });
  return { ok: true, proposalId: current.proposalId };
}

export type MeetingMailResult = { ok: true; sent: number; failed: number } | { ok: false; error: string };

/**
 * Email every reviewer on the round: the invite (with its .ics) or the
 * reminder. Each reviewer's mail names only the sections in their scope.
 * One failed address does not stop the others.
 */
export async function deliverMeetingEmails(input: {
  organizationId: string;
  reviewId: string;
  kind: "invite" | "reminder";
  now?: Date;
}): Promise<MeetingMailResult> {
  const now = input.now ?? new Date();
  const [round] = await db
    .select({
      id: proposalReviews.id,
      proposalId: proposalReviews.proposalId,
      proposalTitle: proposals.title,
      color: proposalReviews.color,
      instructions: proposalReviews.instructions,
      url: proposalReviews.meetingUrl,
      at: proposalReviews.meetingAt,
    })
    .from(proposalReviews)
    .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
    .where(and(eq(proposalReviews.id, input.reviewId), eq(proposals.organizationId, input.organizationId)))
    .limit(1);
  if (!round) return { ok: false, error: "Review not found." };
  if (!round.url || !round.at) return { ok: false, error: "Set a meeting link and a start time first." };

  const reviewers = await db
    .select({ userId: proposalReviewAssignments.userId, email: users.email })
    .from(proposalReviewAssignments)
    .innerJoin(users, eq(users.id, proposalReviewAssignments.userId))
    .where(eq(proposalReviewAssignments.reviewId, round.id));
  if (reviewers.length === 0) return { ok: false, error: "No reviewers are on this round yet." };

  const scopes = await db
    .select({ userId: proposalReviewSectionAssignments.userId, title: proposalSections.title })
    .from(proposalReviewSectionAssignments)
    .innerJoin(proposalSections, eq(proposalSections.id, proposalReviewSectionAssignments.sectionId))
    .where(
      and(
        eq(proposalReviewSectionAssignments.reviewId, round.id),
        inArray(proposalReviewSectionAssignments.userId, reviewers.map((r) => r.userId)),
      ),
    )
    .orderBy(asc(proposalSections.ordering));

  const colorLabel = REVIEW_COLOR_LABELS[round.color];
  const reviewUrl = `${appBaseUrl()}/proposals/${round.proposalId}/reviews/${round.id}`;
  let sent = 0;
  let failed = 0;
  for (const r of reviewers) {
    const sections = scopes.filter((s) => s.userId === r.userId).map((s) => s.title);
    try {
      await sendReviewMeetingEmail({
        to: r.email,
        kind: input.kind,
        proposalTitle: round.proposalTitle,
        colorLabel,
        start: round.at,
        url: round.url,
        sections,
        reviewUrl,
        ...(input.kind === "invite"
          ? {
              ics: buildIcs({
                reviewId: round.id,
                start: round.at,
                summary: `${colorLabel} review: ${round.proposalTitle}`,
                url: round.url,
                sections,
                instructions: round.instructions,
                reviewUrl,
                now,
              }),
            }
          : {}),
      });
      sent += 1;
    } catch (err) {
      failed += 1;
      log.error("[review-meeting]", "email failed", { reviewId: round.id, organizationId: input.organizationId, kind: input.kind, error: err });
    }
  }
  return { ok: true, sent, failed };
}

/** "Send invites": email the reviewers, stamp the round, audit it. */
export async function sendMeetingInvites(input: { organizationId: string; reviewId: string; actor: Actor; now?: Date }): Promise<
  { ok: true; proposalId: string; sent: number; failed: number } | { ok: false; error: string }
> {
  const now = input.now ?? new Date();
  const meeting = await getReviewMeeting(input.organizationId, input.reviewId);
  if (!meeting) return { ok: false, error: "Review not found." };
  const result = await deliverMeetingEmails({ organizationId: input.organizationId, reviewId: input.reviewId, kind: "invite", now });
  if (!result.ok) return result;
  if (result.sent > 0) {
    await db.update(proposalReviews).set({ meetingInvitesSentAt: now, updatedAt: now }).where(eq(proposalReviews.id, input.reviewId));
  }
  await recordAudit({
    organizationId: input.organizationId,
    actor: { userId: input.actor.userId, email: input.actor.email },
    action: "proposal.review.meeting_invites",
    resourceType: "proposal_review",
    resourceId: input.reviewId,
    metadata: { sent: result.sent, failed: result.failed },
  });
  return { ok: true, proposalId: meeting.proposalId, sent: result.sent, failed: result.failed };
}
