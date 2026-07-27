/**
 * BL-FB-SOL-CALENDAR — daily key-date reminder dispatcher.
 *
 * Scans solicitations with upcoming key dates and sends in-app
 * notifications to all assigned team members at T-7, T-3, and T-1
 * days before each date. Runs once per day at 08:00 UTC.
 *
 * Deduplication: checks the notification inbox for an existing entry
 * with the same subject + recipient created in the last 20 hours so
 * accidental double-fires (e.g. Vercel cron retry) don't spam users.
 *
 * Cross-org: the cron is an admin-level background worker, not a user
 * request. Org-scoped filtering would be wrong here. This file lives
 * in src/lib/ with `import "server-only"` so the isolation checker
 * treats cross-org queries here as intentional (same exemption as
 * proposal-scan-cron.ts and notification-cron.ts).
 */
import "server-only";

import { and, eq, gt, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  notifications,
  solicitations,
  solicitationAssignments,
  type SolicitationKeyDate,
} from "@/db/schema";
import { log } from "@/lib/log";

export type KeyDateCronSummary = {
  solicitationsScanned: number;
  remindersDispatched: number;
  duplicatesSkipped: number;
  errors: number;
};

const REMINDER_HORIZONS = [1, 3, 7] as const;

export async function dispatchKeyDateReminders(): Promise<KeyDateCronSummary> {
  const todayUtc = new Date().toISOString().slice(0, 10);

  // Load all solicitations that have at least one key date stored.
  // We use a JSONB length check to skip empty arrays cheaply.
  const rows = await db
    .select({
      id: solicitations.id,
      organizationId: solicitations.organizationId,
      title: solicitations.title,
      keyDates: solicitations.keyDates,
    })
    .from(solicitations)
    .where(
      and(
        isNotNull(solicitations.keyDates),
        ne(sql`jsonb_array_length(${solicitations.keyDates})`, 0),
      ),
    );

  let solicitationsScanned = rows.length;
  let remindersDispatched = 0;
  let duplicatesSkipped = 0;
  let errors = 0;

  for (const row of rows) {
    const keyDates = (row.keyDates ?? []) as SolicitationKeyDate[];

    // Find approaching dates for this solicitation.
    const toNotify: { date: SolicitationKeyDate; daysUntil: number }[] = [];
    for (const kd of keyDates) {
      if (!kd.isoDate) continue;
      const daysUntil = daysUntilDate(todayUtc, kd.isoDate);
      if (REMINDER_HORIZONS.includes(daysUntil as (typeof REMINDER_HORIZONS)[number])) {
        toNotify.push({ date: kd, daysUntil });
      }
    }

    if (toNotify.length === 0) continue;

    // Load team members for this solicitation.
    let teamUserIds: string[];
    try {
      const assignments = await db
        .select({ userId: solicitationAssignments.userId })
        .from(solicitationAssignments)
        .where(eq(solicitationAssignments.solicitationId, row.id));
      const userIdSet = new Set<string>();
      for (const a of assignments) {
        userIdSet.add(a.userId as string);
      }
      teamUserIds = [...userIdSet];
    } catch (err) {
      log.error("[solicitation-key-date-cron]", "team load failed", {
        solicitationId: row.id,
        error: err,
      });
      errors++;
      continue;
    }

    if (teamUserIds.length === 0) continue;

    // Dispatch one notification per (date, member) pair.
    for (const { date, daysUntil } of toNotify) {
      const subject = buildSubject(daysUntil, date.label, row.title);
      const linkPath = `/solicitations/${row.id}`;

      for (const userId of teamUserIds) {
        try {
          // Dedup: skip if an identical subject was already sent to this
          // user in the last 20 hours.
          const recentDup = await db
            .select({ id: notifications.id })
            .from(notifications)
            .where(
              and(
                eq(notifications.organizationId, row.organizationId),
                eq(notifications.recipientUserId, userId),
                eq(notifications.subject, subject),
                gt(
                  notifications.createdAt,
                  new Date(Date.now() - 20 * 60 * 60 * 1000),
                ),
              ),
            )
            .limit(1);

          if (recentDup.length > 0) {
            duplicatesSkipped++;
            continue;
          }

          await db.insert(notifications).values({
            organizationId: row.organizationId,
            recipientUserId: userId,
            kind: "solicitation_role_assigned",
            subject,
            body: buildBody(daysUntil, date, row.title),
            linkPath,
          });
          remindersDispatched++;
        } catch (err) {
          log.error("[solicitation-key-date-cron]", "notification insert failed", {
            solicitationId: row.id,
            userId,
            error: err,
          });
          errors++;
        }
      }
    }
  }

  return { solicitationsScanned, remindersDispatched, duplicatesSkipped, errors };
}

function daysUntilDate(todayIso: string, targetIso: string): number {
  const todayMs = new Date(todayIso + "T00:00:00Z").getTime();
  const targetMs = new Date(targetIso + "T00:00:00Z").getTime();
  return Math.round((targetMs - todayMs) / 86_400_000);
}

function buildSubject(daysUntil: number, label: string, solTitle: string): string {
  return `[T-${daysUntil}] ${label} — ${solTitle.slice(0, 80)}`;
}

function buildBody(
  daysUntil: number,
  date: SolicitationKeyDate,
  solTitle: string,
): string {
  const dayWord = daysUntil === 1 ? "tomorrow" : `in ${daysUntil} days`;
  return `${date.label} is ${dayWord} (${date.isoDate}) for solicitation "${solTitle}".`;
}
