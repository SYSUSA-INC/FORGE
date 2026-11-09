/**
 * BL-NAV-LIFECYCLE 4b-2 — daily `proposal_section_overdue` emitter.
 *
 * Runs from the same daily cron as the key-date and milestone
 * reminders. For every section with an owner whose due date (set on the
 * opportunity's Plan tab) has passed with no draft, it fires the rules
 * engine once per tenant with the owner in `mentionedUserIds`, so the
 * seeded default rule (migration 0164, or `ensureSectionOverdueDefaultRule`
 * for a tenant created later) reaches them; a rule on the "Proposal
 * manager" formula reaches the manager, since the payload carries the
 * proposal. Deduplicated against the delivery ledger by section and due
 * date, so a part is told about once per date: moving the date and
 * missing it again fires again, a cron retry does not.
 *
 * Cross-org by design: this is a background worker, not a user request
 * (same exemption as milestone-due-soon-cron.ts).
 */
import "server-only";

import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { notificationDeliveries, proposalSections, proposals } from "@/db/schema";
import { log } from "@/lib/log";
import { isoDay } from "@/lib/milestone-logic";
import { sectionHasDraft, sectionOverdueMessage } from "@/lib/section-plan-logic";
import { ensureSectionOverdueDefaultRule } from "@/lib/section-plan-store";
import { dispatchTriggerEvent } from "@/lib/notification-dispatcher";

export type SectionOverdueSummary = {
  sectionsScanned: number;
  remindersDispatched: number;
  rulesMatched: number;
  duplicatesSkipped: number;
  errors: number;
};

export async function dispatchSectionOverdue(now = new Date()): Promise<SectionOverdueSummary> {
  const todayIso = isoDay(now);
  const rows = await db
    .select({
      id: proposalSections.id,
      proposalId: proposalSections.proposalId,
      organizationId: proposals.organizationId,
      opportunityId: proposals.opportunityId,
      proposalTitle: proposals.title,
      title: proposalSections.title,
      status: proposalSections.status,
      content: proposalSections.content,
      wordCount: proposalSections.wordCount,
      authorUserId: proposalSections.authorUserId,
      dueDate: proposalSections.dueDate,
    })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .where(and(isNotNull(proposalSections.authorUserId), isNotNull(proposalSections.dueDate), lt(proposalSections.dueDate, todayIso)));

  const summary: SectionOverdueSummary = { sectionsScanned: rows.length, remindersDispatched: 0, rulesMatched: 0, duplicatesSkipped: 0, errors: 0 };

  for (const row of rows) {
    if (!row.authorUserId || !row.dueDate || sectionHasDraft(row)) continue;
    const { organizationId } = row;
    try {
      const [dup] = await db
        .select({ id: notificationDeliveries.id })
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.organizationId, organizationId),
            eq(notificationDeliveries.triggerEventKind, "proposal_section_overdue"),
            sql`${notificationDeliveries.triggerPayload} ->> 'sectionId' = ${row.id}`,
            sql`${notificationDeliveries.triggerPayload} ->> 'dueDate' = ${row.dueDate}`,
          ),
        )
        .limit(1);
      if (dup) {
        summary.duplicatesSkipped += 1;
        continue;
      }
      await ensureSectionOverdueDefaultRule(organizationId);
      const msg = sectionOverdueMessage({ sectionTitle: row.title, proposalTitle: row.proposalTitle ?? "", dueDate: row.dueDate, todayIso });
      const result = await dispatchTriggerEvent({
        organizationId,
        kind: "proposal_section_overdue",
        payload: { proposalId: row.proposalId, opportunityId: row.opportunityId, sectionId: row.id, sectionTitle: row.title, dueDate: row.dueDate, authorUserId: row.authorUserId, mentionedUserIds: [row.authorUserId] },
        subject: msg.subject,
        body: msg.body,
        linkPath: `/proposals/${row.proposalId}/sections`,
        proposalId: row.proposalId,
      });
      summary.rulesMatched += result.rulesMatched;
      if (result.deliveries > 0) summary.remindersDispatched += 1;
    } catch (err) {
      summary.errors += 1;
      log.error("[section-overdue-cron]", "dispatch failed", { sectionId: row.id, organizationId, error: err });
    }
  }
  return summary;
}
