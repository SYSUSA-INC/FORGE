import "server-only";

import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  notifications,
  notificationDeliveries,
  notificationRules,
} from "@/db/schema";
import { log } from "@/lib/log";

/**
 * BL-13 Phase D — batched-frequency materialization.
 *
 * The Phase C dispatcher creates notification_delivery rows with
 * sent_at = null when the rule's frequency is `batched_daily` or
 * `batched_weekly`. This cron picks them up and:
 *   - For each recipient + channel, collapses outstanding pending
 *     deliveries into a single inbox row (one row per recipient per
 *     day/week per channel)
 *   - Marks all the underlying delivery rows as sent_at = now()
 *
 * Frequency cadence:
 *   - batched_daily   — materialized once per cron run
 *   - batched_weekly  — only materialized on Sundays (UTC), so users
 *                       get exactly one weekly digest
 *
 * Best-effort per-org: an error materializing one tenant doesn't
 * block subsequent tenants.
 */
export type BatchesResult = {
  rulesScanned: number;
  inboxRowsCreated: number;
  deliveriesMarkedSent: number;
};

const BATCHED_FREQUENCIES = ["batched_daily", "batched_weekly"] as const;

export async function materializeNotificationBatches(): Promise<BatchesResult> {
  const now = new Date();
  const isWeeklyDay = now.getUTCDay() === 0; // Sunday UTC

  let inboxRowsCreated = 0;
  let deliveriesMarkedSent = 0;
  let rulesScanned = 0;

  for (const frequency of BATCHED_FREQUENCIES) {
    if (frequency === "batched_weekly" && !isWeeklyDay) continue;

    // Find rules at this cadence with pending deliveries. One query
    // per cadence so the cron stays linear in tenants × cadences.
    const rulesWithPending = await db
      .selectDistinct({
        ruleId: notificationDeliveries.ruleId,
        organizationId: notificationDeliveries.organizationId,
      })
      .from(notificationDeliveries)
      .innerJoin(
        notificationRules,
        // Belt-and-suspenders tenant isolation in the join: rule.id
        // matches AND both rows belong to the same org. Defends against
        // any future code path that might let a delivery row reference
        // a rule from a different tenant (shouldn't happen given the
        // dispatcher's invariants, but cross-tenant SQL leaks are the
        // class of bug we never want to discover the hard way).
        and(
          eq(notificationRules.id, notificationDeliveries.ruleId),
          eq(
            notificationRules.organizationId,
            notificationDeliveries.organizationId,
          ),
        ),
      )
      .where(
        and(
          eq(notificationRules.frequency, frequency),
          isNull(notificationDeliveries.sentAt),
        ),
      );

    rulesScanned += rulesWithPending.length;

    for (const { ruleId, organizationId } of rulesWithPending) {
      try {
        // Pull every pending delivery for this rule.
        const pending = await db
          .select({
            id: notificationDeliveries.id,
            recipientUserId: notificationDeliveries.recipientUserId,
            channel: notificationDeliveries.channel,
            triggerEventKind: notificationDeliveries.triggerEventKind,
            triggerPayload: notificationDeliveries.triggerPayload,
          })
          .from(notificationDeliveries)
          .where(
            and(
              eq(notificationDeliveries.ruleId, ruleId),
              eq(notificationDeliveries.organizationId, organizationId),
              isNull(notificationDeliveries.sentAt),
            ),
          );

        if (pending.length === 0) continue;

        // Look up the rule's recipient_strategy + name for the inbox subject.
        const [rule] = await db
          .select({
            name: notificationRules.name,
            channels: notificationRules.channels,
          })
          .from(notificationRules)
          .where(
            and(
              eq(notificationRules.id, ruleId),
              eq(notificationRules.organizationId, organizationId),
            ),
          )
          .limit(1);

        if (!rule) continue;

        // Group pending deliveries by (recipient, channel) — one
        // inbox row per group.
        const groups = new Map<
          string,
          { recipientUserId: string; channel: string; deliveryIds: string[] }
        >();
        for (const p of pending) {
          if (!p.recipientUserId) continue;
          const key = `${p.recipientUserId}::${p.channel}`;
          const existing = groups.get(key);
          if (existing) {
            existing.deliveryIds.push(p.id);
          } else {
            groups.set(key, {
              recipientUserId: p.recipientUserId,
              channel: p.channel,
              deliveryIds: [p.id],
            });
          }
        }

        // Materialize one inbox row per (recipient, in_app) group.
        // Other channels (email) only get the sent_at marker — the
        // actual email sending lands when the email integration is wired.
        const inboxRows = Array.from(groups.values())
          .filter((g) => g.channel === "in_app")
          .map((g) => ({
            organizationId,
            recipientUserId: g.recipientUserId,
            actorUserId: null,
            kind: "review_assigned" as const,
            subject: `${rule.name} — ${g.deliveryIds.length} ${
              frequency === "batched_daily" ? "daily" : "weekly"
            } update${g.deliveryIds.length === 1 ? "" : "s"}`,
            body: "",
            linkPath: "/notifications",
            proposalId: null,
            reviewId: null,
            commentId: null,
          }));

        if (inboxRows.length > 0) {
          await db.insert(notifications).values(inboxRows);
          inboxRowsCreated += inboxRows.length;
        }

        // Mark every pending delivery for this rule as sent.
        const pendingIds = pending.map((p) => p.id);
        if (pendingIds.length > 0) {
          await db
            .update(notificationDeliveries)
            .set({ sentAt: now })
            .where(
              and(
                eq(notificationDeliveries.organizationId, organizationId),
                eq(notificationDeliveries.ruleId, ruleId),
                isNull(notificationDeliveries.sentAt),
              ),
            );
          deliveriesMarkedSent += pendingIds.length;
        }
      } catch (err) {
        log.error("[materializeNotificationBatches]", "rule failed", {
          error: err,
          ruleId,
          organizationId,
        });
      }
    }
  }

  return { rulesScanned, inboxRowsCreated, deliveriesMarkedSent };
}

/**
 * BL-13 Phase D — SLA breach + escalation.
 *
 * Scans for delivery rows that have been sent but not acknowledged
 * past their rule's `sla_seconds`. For each:
 *   - Sets sla_breached_at = now()
 *   - If the rule has an escalation_strategy, resolves the fallback
 *     recipients and creates new delivery rows for them
 *
 * Per-tenant; queries scoped by organizationId at each iteration.
 */
export type SlaResult = {
  rowsScanned: number;
  breachedMarked: number;
  escalationsCreated: number;
};

export async function processSlaBreaches(): Promise<SlaResult> {
  const now = new Date();
  let breachedMarked = 0;
  let escalationsCreated = 0;

  // Find delivery rows past their rule's SLA — unacked, sent, no
  // prior breach mark.
  const candidates = await db
    .select({
      id: notificationDeliveries.id,
      organizationId: notificationDeliveries.organizationId,
      ruleId: notificationDeliveries.ruleId,
      triggerEventKind: notificationDeliveries.triggerEventKind,
      triggerPayload: notificationDeliveries.triggerPayload,
      sentAt: notificationDeliveries.sentAt,
      slaSeconds: notificationRules.slaSeconds,
      escalationStrategy: notificationRules.escalationStrategy,
    })
    .from(notificationDeliveries)
    .innerJoin(
      notificationRules,
      // Same tenant-isolation belt-and-suspenders as the batches helper:
      // rule must match by id AND by organization_id.
      and(
        eq(notificationRules.id, notificationDeliveries.ruleId),
        eq(
          notificationRules.organizationId,
          notificationDeliveries.organizationId,
        ),
      ),
    )
    .where(
      and(
        isNull(notificationDeliveries.ackedAt),
        isNull(notificationDeliveries.slaBreachedAt),
        sql`${notificationRules.slaSeconds} IS NOT NULL`,
        sql`${notificationDeliveries.sentAt} IS NOT NULL`,
        lt(
          notificationDeliveries.sentAt,
          sql`now() - (${notificationRules.slaSeconds} || ' seconds')::interval`,
        ),
      ),
    );

  const rowsScanned = candidates.length;

  // Lazy-import the resolver to avoid a circular import — dispatcher
  // also uses resolveRecipients.
  const { resolveRecipients } = await import(
    "@/lib/notification-recipient-resolver"
  );

  for (const c of candidates) {
    try {
      await db
        .update(notificationDeliveries)
        .set({ slaBreachedAt: now })
        .where(
          and(
            eq(notificationDeliveries.id, c.id),
            eq(notificationDeliveries.organizationId, c.organizationId),
          ),
        );
      breachedMarked += 1;

      const esc = c.escalationStrategy;
      if (!esc) continue;
      if (
        !esc.strategy ||
        !["specific_users", "role_based", "formula"].includes(esc.strategy)
      ) {
        continue;
      }

      const fallbackIds = await resolveRecipients({
        organizationId: c.organizationId,
        strategy: esc.strategy,
        config: esc.config ?? {},
        payload: c.triggerPayload,
      });

      if (fallbackIds.length === 0) continue;

      // Create escalation delivery rows (in_app only for Phase D;
      // future channels handled when wired).
      const escRows = fallbackIds.map((userId) => ({
        organizationId: c.organizationId,
        ruleId: c.ruleId,
        triggerEventKind: c.triggerEventKind,
        triggerPayload: c.triggerPayload,
        recipientUserId: userId,
        channel: "in_app" as const,
        sentAt: now,
        error: "",
      }));

      await db.insert(notificationDeliveries).values(escRows);
      escalationsCreated += escRows.length;

      // Mark the original delivery as escalated.
      await db
        .update(notificationDeliveries)
        .set({ escalatedAt: now })
        .where(
          and(
            eq(notificationDeliveries.id, c.id),
            eq(notificationDeliveries.organizationId, c.organizationId),
          ),
        );
    } catch (err) {
      log.error("[processSlaBreaches]", "row failed", {
        error: err,
        deliveryId: c.id,
        organizationId: c.organizationId,
      });
    }
  }

  return { rowsScanned, breachedMarked, escalationsCreated };
}
