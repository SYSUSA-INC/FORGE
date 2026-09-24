/**
 * BL-AIP-3 — daily `opportunity_due_soon` emitter.
 *
 * Runs from the same daily cron as the solicitation key-date reminders.
 * For every open opportunity whose response due date is exactly 7, 3 or
 * 1 days away it fires the BL-13 rules engine once per tenant, so
 * whatever rules the tenant configured (recipients, channels, digest
 * cadence) decide who hears about it. Deduplicated against the
 * delivery ledger so a cron retry never double-fires.
 *
 * Cross-org by design: this is a background worker, not a user request
 * (same exemption as solicitation-key-date-cron.ts). Each dispatch is
 * per-organization.
 */
import "server-only";

import { and, eq, gt, gte, isNotNull, lte, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { notificationDeliveries, opportunities } from "@/db/schema";
import { log } from "@/lib/log";
import { dispatchTriggerEvent } from "@/lib/notification-dispatcher";
import {
  dueSoonBody,
  dueSoonHorizon,
  dueSoonSubject,
} from "@/lib/opportunity-due-soon";

export type DueSoonSummary = {
  opportunitiesScanned: number;
  remindersDispatched: number;
  rulesMatched: number;
  duplicatesSkipped: number;
  errors: number;
};

const DEDUP_WINDOW_MS = 20 * 60 * 60 * 1000;

export async function dispatchOpportunityDueSoon(): Promise<DueSoonSummary> {
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  // Window wide enough to hold every horizon plus a day of slack either side.
  const from = new Date(now.getTime() - 86_400_000);
  const to = new Date(now.getTime() + 9 * 86_400_000);

  const rows = await db
    .select({
      id: opportunities.id,
      organizationId: opportunities.organizationId,
      title: opportunities.title,
      agency: opportunities.agency,
      stage: opportunities.stage,
      responseDueDate: opportunities.responseDueDate,
    })
    .from(opportunities)
    .where(
      and(
        isNotNull(opportunities.responseDueDate),
        gte(opportunities.responseDueDate, from),
        lte(opportunities.responseDueDate, to),
        notInArray(opportunities.stage, ["won", "lost", "no_bid"]),
      ),
    );

  const summary: DueSoonSummary = {
    opportunitiesScanned: rows.length,
    remindersDispatched: 0,
    rulesMatched: 0,
    duplicatesSkipped: 0,
    errors: 0,
  };

  for (const row of rows) {
    const horizon = dueSoonHorizon(todayIso, row.responseDueDate);
    if (!horizon) continue;
    const { organizationId } = row;
    const dueIso = row.responseDueDate!.toISOString().slice(0, 10);

    try {
      const [dup] = await db
        .select({ id: notificationDeliveries.id })
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.organizationId, organizationId),
            eq(notificationDeliveries.triggerEventKind, "opportunity_due_soon"),
            gt(notificationDeliveries.createdAt, new Date(now.getTime() - DEDUP_WINDOW_MS)),
            sql`${notificationDeliveries.triggerPayload} ->> 'opportunityId' = ${row.id}`,
            sql`${notificationDeliveries.triggerPayload} ->> 'daysUntil' = ${String(horizon)}`,
          ),
        )
        .limit(1);
      if (dup) {
        summary.duplicatesSkipped += 1;
        continue;
      }

      const result = await dispatchTriggerEvent({
        organizationId,
        kind: "opportunity_due_soon",
        payload: {
          opportunityId: row.id,
          daysUntil: horizon,
          dueDate: dueIso,
          stage: row.stage,
          agency: row.agency,
        },
        subject: dueSoonSubject(horizon, row.title, dueIso),
        body: dueSoonBody(horizon, row.title, dueIso),
        linkPath: `/opportunities/${row.id}`,
      });
      summary.rulesMatched += result.rulesMatched;
      if (result.deliveries > 0) summary.remindersDispatched += 1;
    } catch (err) {
      summary.errors += 1;
      log.error("[opportunity-due-soon-cron]", "dispatch failed", {
        opportunityId: row.id,
        organizationId,
        error: err,
      });
    }
  }

  return summary;
}
