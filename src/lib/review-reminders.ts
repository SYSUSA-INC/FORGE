/**
 * BL-FB-X-COLOR-TEAM Slice 2 — the day-before reminder for a colour-team
 * round. From the daily cron: every open round within a day of its due
 * date (or past it) that has not been reminded yet fires the rules-engine
 * `review_due_soon` trigger once, naming only the reviewers who have not
 * submitted a verdict, and is stamped so it never fires twice.
 *
 * Cross-org by design: a background worker, not a user request (same
 * exemption as opportunity-due-soon-cron.ts); each dispatch is
 * per-organization through `row.organizationId`.
 */
import "server-only";

import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { proposalReviewAssignments, proposalReviews, proposals } from "@/db/schema";
import { log } from "@/lib/log";
import { dispatchTriggerEvent } from "@/lib/notification-dispatcher";
import { REVIEW_COLOR_LABELS } from "@/lib/review-types";
import { DUE_REMINDER_HORIZON_MS, dueReminderDue, dueReminderSubject } from "@/lib/review-workflow-logic";

export type ReviewReminderSummary = { reviewsDue: number; remindersDispatched: number; reviewersReminded: number; errors: number };

export async function dispatchReviewDueReminders(now: Date = new Date()): Promise<ReviewReminderSummary> {
  const rows = await db
    .select({
      id: proposalReviews.id,
      organizationId: proposals.organizationId,
      proposalId: proposalReviews.proposalId,
      proposalTitle: proposals.title,
      color: proposalReviews.color,
      dueDate: proposalReviews.dueDate,
    })
    .from(proposalReviews)
    .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
    .where(
      and(
        eq(proposalReviews.status, "in_progress"),
        isNotNull(proposalReviews.dueDate),
        isNull(proposalReviews.dueReminderSentAt),
        lte(proposalReviews.dueDate, new Date(now.getTime() + DUE_REMINDER_HORIZON_MS)),
      ),
    );

  const summary: ReviewReminderSummary = { reviewsDue: 0, remindersDispatched: 0, reviewersReminded: 0, errors: 0 };
  for (const row of rows) {
    if (!dueReminderDue(now, row.dueDate)) continue;
    summary.reviewsDue += 1;
    const { organizationId } = row;
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
          payload: { proposalId: row.proposalId, reviewId: row.id, color: row.color, dueDate: dueIso, mentionedUserIds: pendingIds },
          subject: dueReminderSubject(REVIEW_COLOR_LABELS[row.color], row.proposalTitle, row.dueDate!, now),
          body: `Due ${dueIso}. Open the review, finish your checklist and submit your verdict.`,
          linkPath: `/proposals/${row.proposalId}/reviews/${row.id}`,
          proposalId: row.proposalId,
          reviewId: row.id,
        });
        if (result.deliveries > 0) {
          summary.remindersDispatched += 1;
          summary.reviewersReminded += pendingIds.length;
        }
      }
      // Stamped either way: a round everyone already submitted needs no second look.
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
