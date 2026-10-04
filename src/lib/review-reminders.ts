/**
 * BL-FB-X-COLOR-TEAM Slice 2 — the reminder for a colour-team round.
 * From the daily cron: every open round whose due date is near fires the
 * rules-engine `review_due_soon` trigger, naming only the reviewers who
 * have not submitted a verdict, and is stamped so it does not fire twice
 * for the same reminder.
 *
 * Slice 3: the pace is the tenant's (`organization.review_reminder_*`):
 * first `daysBefore` days ahead of the due date, then again every
 * `repeatDays` days while the round is overdue (0 = once only).
 *
 * Cross-org by design: a background worker, not a user request (same
 * exemption as opportunity-due-soon-cron.ts); each dispatch is
 * per-organization through `row.organizationId`.
 */
import "server-only";

import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { organizations, proposalReviewAssignments, proposalReviews, proposals } from "@/db/schema";
import { log } from "@/lib/log";
import { dispatchTriggerEvent } from "@/lib/notification-dispatcher";
import { REVIEW_COLOR_LABELS } from "@/lib/review-types";
import { DEFAULT_REMINDER_CADENCE, REMINDER_CADENCE_LIMITS, dueReminderSubject, reviewReminderDue, roundCadence, sanitizeReminderCadence } from "@/lib/review-workflow-logic";

export type ReviewReminderSummary = { reviewsDue: number; remindersDispatched: number; reviewersReminded: number; repeats: number; errors: number };

/** The widest "days before" any tenant may set bounds the scan. */
const MAX_HORIZON_MS = REMINDER_CADENCE_LIMITS.daysBefore.max * 24 * 60 * 60 * 1000;

export async function dispatchReviewDueReminders(now: Date = new Date()): Promise<ReviewReminderSummary> {
  const rows = await db
    .select({
      id: proposalReviews.id,
      organizationId: proposals.organizationId,
      proposalId: proposalReviews.proposalId,
      proposalTitle: proposals.title,
      color: proposalReviews.color,
      dueDate: proposalReviews.dueDate,
      sentAt: proposalReviews.dueReminderSentAt,
      daysBefore: organizations.reviewReminderDaysBefore,
      repeatDays: organizations.reviewReminderRepeatDays,
      roundDaysBefore: proposalReviews.reminderDaysBefore,
      roundRepeatDays: proposalReviews.reminderRepeatDays,
    })
    .from(proposalReviews)
    .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
    .innerJoin(organizations, eq(organizations.id, proposals.organizationId))
    .where(
      and(
        eq(proposalReviews.status, "in_progress"),
        isNotNull(proposalReviews.dueDate),
        isNull(organizations.disabledAt),
        lte(proposalReviews.dueDate, new Date(now.getTime() + MAX_HORIZON_MS)),
      ),
    );

  const summary: ReviewReminderSummary = { reviewsDue: 0, remindersDispatched: 0, reviewersReminded: 0, repeats: 0, errors: 0 };
  for (const row of rows) {
    // Slice 4 — a round's own cadence wins over the tenant's.
    const team = sanitizeReminderCadence({ daysBefore: row.daysBefore, repeatDays: row.repeatDays }) ?? DEFAULT_REMINDER_CADENCE;
    const { cadence } = roundCadence({ daysBefore: row.roundDaysBefore, repeatDays: row.roundRepeatDays }, team);
    if (!reviewReminderDue(now, row.dueDate, row.sentAt, cadence)) continue;
    summary.reviewsDue += 1;
    const { organizationId } = row;
    const repeat = !!row.sentAt;
    try {
      const pending = await db
        .select({ userId: proposalReviewAssignments.userId })
        .from(proposalReviewAssignments)
        .where(and(eq(proposalReviewAssignments.reviewId, row.id), isNull(proposalReviewAssignments.submittedAt)));
      const pendingIds = pending.map((p) => p.userId);
      if (pendingIds.length > 0) {
        const dueIso = row.dueDate!.toISOString().slice(0, 10);
        const result = await dispatchTriggerEvent({
          organizationId,
          kind: "review_due_soon",
          payload: { proposalId: row.proposalId, reviewId: row.id, color: row.color, dueDate: dueIso, repeat, mentionedUserIds: pendingIds },
          subject: dueReminderSubject(REVIEW_COLOR_LABELS[row.color], row.proposalTitle, row.dueDate!, now),
          body: repeat
            ? `Due ${dueIso} and still open. Open the review, finish your checklist and submit your verdict.`
            : `Due ${dueIso}. Open the review, finish your checklist and submit your verdict.`,
          linkPath: `/proposals/${row.proposalId}/reviews/${row.id}`,
          proposalId: row.proposalId,
          reviewId: row.id,
        });
        if (result.deliveries > 0) {
          summary.remindersDispatched += 1;
          summary.reviewersReminded += pendingIds.length;
          if (repeat) summary.repeats += 1;
        }
      }
      // Stamped either way: a round everyone already submitted needs no
      // second look until the next repeat, if the tenant set one.
      await db
        .update(proposalReviews)
        .set({ dueReminderSentAt: now })
        .where(eq(proposalReviews.id, row.id));
    } catch (err) {
      summary.errors += 1;
      log.error("[review-reminders]", "dispatch failed", { reviewId: row.id, organizationId, error: err });
    }
  }
  return summary;
}
