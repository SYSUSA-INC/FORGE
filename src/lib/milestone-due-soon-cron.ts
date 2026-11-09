/**
 * BL-NAV-LIFECYCLE 4b-1 — daily `milestone_due_soon` emitter.
 *
 * Runs from the same daily cron as the key-date reminders and
 * `opportunity_due_soon`. For every planned milestone exactly 7, 3 or 1
 * days away that has an owner, it fires the rules engine once per
 * tenant with the owner in `mentionedUserIds`, so the seeded default
 * rule (migration 0162, or `ensureMilestoneDefaultRule` for a tenant
 * created later) reaches them in the inbox and by email. Deduplicated
 * against the delivery ledger so a cron retry never double-fires. A
 * milestone with no owner (a colour team's round, by default) is
 * skipped: its reviewers hear from the round itself.
 *
 * Cross-org by design: this is a background worker, not a user request
 * (same exemption as opportunity-due-soon-cron.ts).
 */
import "server-only";

import { and, eq, gt, gte, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { notificationDeliveries, opportunities, opportunityMilestones } from "@/db/schema";
import { log } from "@/lib/log";
import { addDays, isoDay, milestoneDueSoonMessage, milestoneHorizon } from "@/lib/milestone-logic";
import { ensureMilestoneDefaultRule } from "@/lib/milestone-store";
import { dispatchTriggerEvent } from "@/lib/notification-dispatcher";

export type MilestoneDueSoonSummary = {
  milestonesScanned: number;
  remindersDispatched: number;
  rulesMatched: number;
  duplicatesSkipped: number;
  errors: number;
};

const DEDUP_WINDOW_MS = 20 * 60 * 60 * 1000;

export async function dispatchMilestoneDueSoon(now = new Date()): Promise<MilestoneDueSoonSummary> {
  const todayIso = isoDay(now);
  const rows = await db
    .select({
      id: opportunityMilestones.id,
      organizationId: opportunityMilestones.organizationId,
      opportunityId: opportunityMilestones.opportunityId,
      planId: opportunityMilestones.planId,
      title: opportunityMilestones.title,
      kind: opportunityMilestones.kind,
      date: opportunityMilestones.date,
      ownerUserId: opportunityMilestones.ownerUserId,
      opportunityTitle: opportunities.title,
    })
    .from(opportunityMilestones)
    .innerJoin(opportunities, eq(opportunities.id, opportunityMilestones.opportunityId))
    .where(
      and(
        eq(opportunityMilestones.status, "planned"),
        isNotNull(opportunityMilestones.ownerUserId),
        gte(opportunityMilestones.date, todayIso),
        lte(opportunityMilestones.date, addDays(todayIso, 7)),
      ),
    );

  const summary: MilestoneDueSoonSummary = { milestonesScanned: rows.length, remindersDispatched: 0, rulesMatched: 0, duplicatesSkipped: 0, errors: 0 };

  for (const row of rows) {
    const horizon = milestoneHorizon(todayIso, row.date);
    if (!horizon || !row.ownerUserId) continue;
    const { organizationId } = row;
    try {
      const [dup] = await db
        .select({ id: notificationDeliveries.id })
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.organizationId, organizationId),
            eq(notificationDeliveries.triggerEventKind, "milestone_due_soon"),
            gt(notificationDeliveries.createdAt, new Date(now.getTime() - DEDUP_WINDOW_MS)),
            sql`${notificationDeliveries.triggerPayload} ->> 'milestoneId' = ${row.id}`,
            sql`${notificationDeliveries.triggerPayload} ->> 'daysUntil' = ${String(horizon)}`,
          ),
        )
        .limit(1);
      if (dup) {
        summary.duplicatesSkipped += 1;
        continue;
      }
      await ensureMilestoneDefaultRule(organizationId);
      const msg = milestoneDueSoonMessage({ horizon, title: row.title, dateIso: row.date, opportunityTitle: row.opportunityTitle ?? "" });
      const result = await dispatchTriggerEvent({
        organizationId,
        kind: "milestone_due_soon",
        payload: { opportunityId: row.opportunityId, planId: row.planId, milestoneId: row.id, milestoneKind: row.kind, daysUntil: horizon, date: row.date, ownerUserId: row.ownerUserId, mentionedUserIds: [row.ownerUserId] },
        subject: msg.subject,
        body: msg.body,
        linkPath: `/opportunities/${row.opportunityId}/plan`,
      });
      summary.rulesMatched += result.rulesMatched;
      if (result.deliveries > 0) summary.remindersDispatched += 1;
    } catch (err) {
      summary.errors += 1;
      log.error("[milestone-due-soon-cron]", "dispatch failed", { milestoneId: row.id, organizationId, error: err });
    }
  }
  return summary;
}
