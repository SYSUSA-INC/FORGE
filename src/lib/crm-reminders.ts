/**
 * BL-FB-X-CRM Slice 2 — the follow-up nudge. From the daily cron: every
 * contact whose agreed next touch is within a day (or past) and whose
 * owner has not been reminded for that date fires the rules-engine
 * `contact_touch_due` trigger to the relationship owner, then is stamped
 * with the date it was reminded for so a new agreed date re-arms it and
 * the same date never fires twice. Contacts with no owner have nobody to
 * nudge and are skipped (counted, so the cron body shows the gap).
 *
 * Cross-org by design: a background worker, not a user request (same
 * exemption as review-reminders.ts); each dispatch is per-organization
 * through `row.organizationId`.
 */
import "server-only";

import { and, eq, isNotNull, lte } from "drizzle-orm";
import { db } from "@/db";
import { customerContacts } from "@/db/schema";
import { TOUCH_REMINDER_HORIZON_MS, describeRecency, touchReminderDue, touchReminderSubject } from "@/lib/crm-logic";
import { log } from "@/lib/log";
import { dispatchTriggerEvent } from "@/lib/notification-dispatcher";

export type ContactReminderSummary = { contactsDue: number; remindersDispatched: number; unowned: number; errors: number };

export async function dispatchContactTouchReminders(now: Date = new Date()): Promise<ContactReminderSummary> {
  const rows = await db
    .select({
      id: customerContacts.id,
      organizationId: customerContacts.organizationId,
      name: customerContacts.name,
      agency: customerContacts.agency,
      ownerUserId: customerContacts.ownerUserId,
      lastTouchAt: customerContacts.lastTouchAt,
      nextTouchAt: customerContacts.nextTouchAt,
      touchReminderFor: customerContacts.touchReminderFor,
    })
    .from(customerContacts)
    .where(and(isNotNull(customerContacts.nextTouchAt), lte(customerContacts.nextTouchAt, new Date(now.getTime() + TOUCH_REMINDER_HORIZON_MS))));

  const summary: ContactReminderSummary = { contactsDue: 0, remindersDispatched: 0, unowned: 0, errors: 0 };
  for (const row of rows) {
    if (!touchReminderDue(now, row.nextTouchAt, row.touchReminderFor)) continue;
    summary.contactsDue += 1;
    const { organizationId } = row;
    if (!row.ownerUserId) {
      summary.unowned += 1;
      continue;
    }
    try {
      const dueIso = row.nextTouchAt!.toISOString().slice(0, 10);
      const result = await dispatchTriggerEvent({
        organizationId,
        kind: "contact_touch_due",
        payload: { contactId: row.id, agency: row.agency, nextTouchAt: dueIso, mentionedUserIds: [row.ownerUserId] },
        subject: touchReminderSubject(row.name, row.agency, row.nextTouchAt!, now),
        body: `Agreed for ${dueIso}. ${describeRecency(row.lastTouchAt, now)}. Log the touch and set the next one.`,
        linkPath: `/contacts/${row.id}`,
      });
      if (result.deliveries > 0) summary.remindersDispatched += 1;
      // Stamped with the date, not the time: a new agreed date re-arms the reminder.
      await db
        .update(customerContacts)
        .set({ touchReminderFor: row.nextTouchAt })
        .where(and(eq(customerContacts.id, row.id), eq(customerContacts.organizationId, organizationId)));
    } catch (err) {
      summary.errors += 1;
      log.error("[crm-reminders]", "dispatch failed", { contactId: row.id, organizationId, error: err });
    }
  }
  return summary;
}
