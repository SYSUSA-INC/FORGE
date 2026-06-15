import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  notifications,
  notificationDeliveries,
  notificationRules,
  type NotificationChannel,
  type NotificationTriggerEventKind,
} from "@/db/schema";
import { log } from "@/lib/log";
import { resolveRecipients } from "@/lib/notification-recipient-resolver";

/**
 * BL-13 Phase C — trigger event dispatcher.
 *
 * Server-side entry point for emitting a notification trigger. Reads
 * matching active rules for the tenant + event kind, resolves
 * recipients per rule, then creates one `notification_delivery` row
 * per (rule × recipient × channel). For `in_app`, also appends a
 * row to the existing `notification` table so it appears in the
 * recipient's inbox.
 *
 * Best-effort: every error is caught + logged, never re-thrown, so
 * the calling action's user-facing flow is never blocked by
 * notification failure. The audit trail in /audit-log captures the
 * action that fired regardless.
 *
 * Frequency semantics:
 *   - immediate    → delivery row created with sent_at = now()
 *   - batched_*    → delivery row created with sent_at = null; the
 *                    Phase D cron materializes batches and sets sent_at
 *
 * Channel semantics (Phase C scope):
 *   - in_app  → creates notification_delivery + notification rows
 *   - email   → creates notification_delivery row; sending logic
 *                lands in Phase D when the email integration is wired
 *   - slack/teams → creates a delivery row with error="not implemented"
 *                   so the audit trail captures the gap
 */
export type DispatchInput = {
  organizationId: string;
  kind: NotificationTriggerEventKind;
  /**
   * Payload used by both `matchFilter` (subset-equality match) and
   * formula recipient resolution (looks up proposalId / opportunityId /
   * sectionId from here). Free-form jsonb on the rule side; the
   * dispatcher only enforces shape per resolver.
   */
  payload: Record<string, unknown>;
  /** Friendly subject for the in-app inbox row. */
  subject: string;
  /** Optional longer body for the in-app inbox row. */
  body?: string;
  /** Where the click-through lands; surfaced on the in-app row. */
  linkPath?: string;
  /** Optional ids tying the inbox row to a specific proposal/review/comment. */
  proposalId?: string;
  reviewId?: string;
  commentId?: string;
  /** The user who triggered the event, if attributable. */
  actorUserId?: string;
};

export async function dispatchTriggerEvent(input: DispatchInput): Promise<void> {
  const { organizationId, kind, payload } = input;
  try {
    const rules = await db
      .select({
        id: notificationRules.id,
        matchFilter: notificationRules.matchFilter,
        recipientStrategy: notificationRules.recipientStrategy,
        recipientConfig: notificationRules.recipientConfig,
        channels: notificationRules.channels,
        frequency: notificationRules.frequency,
      })
      .from(notificationRules)
      .where(
        and(
          eq(notificationRules.organizationId, organizationId),
          eq(notificationRules.triggerEventKind, kind),
          eq(notificationRules.active, true),
        ),
      );

    if (rules.length === 0) return;

    for (const rule of rules) {
      if (!matchFilterApplies(rule.matchFilter, payload)) continue;

      const recipientIds = await resolveRecipients({
        organizationId,
        strategy: rule.recipientStrategy,
        config: rule.recipientConfig,
        payload,
      });

      if (recipientIds.length === 0) continue;

      const isImmediate = rule.frequency === "immediate";
      const sentAt = isImmediate ? new Date() : null;

      // Build the delivery rows. One per (recipient × channel).
      const deliveryRows: Array<{
        organizationId: string;
        ruleId: string;
        triggerEventKind: NotificationTriggerEventKind;
        triggerPayload: Record<string, unknown>;
        recipientUserId: string;
        channel: NotificationChannel;
        sentAt: Date | null;
        error: string;
      }> = [];

      for (const userId of recipientIds) {
        for (const channel of rule.channels) {
          const supported = channel === "in_app" || channel === "email";
          deliveryRows.push({
            organizationId,
            ruleId: rule.id,
            triggerEventKind: kind,
            triggerPayload: payload,
            recipientUserId: userId,
            channel,
            sentAt: supported ? sentAt : null,
            error: supported ? "" : "channel not yet implemented",
          });
        }
      }

      if (deliveryRows.length === 0) continue;

      try {
        await db.insert(notificationDeliveries).values(deliveryRows);
      } catch (err) {
        log.error("[dispatchTriggerEvent]", "delivery insert failed", {
          error: err,
          ruleId: rule.id,
          organizationId,
        });
        continue;
      }

      // For immediate + in_app, also append a row to the legacy
      // `notification` table so it shows up in the user's inbox.
      // Batched in-app rows materialize via the Phase D cron.
      if (!isImmediate) continue;
      if (!rule.channels.includes("in_app")) continue;
      if (recipientIds.length === 0) continue;

      const inboxRows = recipientIds.map((userId) => ({
        organizationId,
        recipientUserId: userId,
        actorUserId: input.actorUserId ?? null,
        // Map the new trigger kind into the existing notification_kind
        // enum where there's an obvious 1:1. Anything else falls back
        // to `review_completed` so the row still renders — Phase E
        // will widen the legacy enum.
        kind: legacyKindFor(kind),
        subject: input.subject,
        body: input.body ?? "",
        linkPath: input.linkPath ?? "",
        proposalId: input.proposalId ?? null,
        reviewId: input.reviewId ?? null,
        commentId: input.commentId ?? null,
      }));

      try {
        await db.insert(notifications).values(inboxRows);
      } catch (err) {
        log.error("[dispatchTriggerEvent]", "inbox insert failed", {
          error: err,
          ruleId: rule.id,
          organizationId,
        });
      }
    }
  } catch (err) {
    log.error("[dispatchTriggerEvent]", "top-level failure", {
      error: err,
      organizationId,
      kind,
    });
  }
}

/**
 * Subset-equality match. An empty filter matches everything; a
 * non-empty filter matches when every key/value in the filter
 * appears (==) in the payload. Values are JSON-comparable.
 */
function matchFilterApplies(
  filter: Record<string, unknown>,
  payload: Record<string, unknown>,
): boolean {
  const keys = Object.keys(filter);
  if (keys.length === 0) return true;
  for (const key of keys) {
    if (!equals(filter[key], payload[key])) return false;
  }
  return true;
}

function equals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === "object") {
    // Cheap deep-equal via JSON.stringify; matchFilter values are
    // expected to be primitives or shallow objects.
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Map the new BL-13 trigger event kinds into the legacy `notification`
 * table's `notification_kind` enum. Used so the existing in-app inbox
 * keeps rendering rows from the new engine without an enum widening
 * (deferred to Phase E).
 */
function legacyKindFor(kind: NotificationTriggerEventKind) {
  switch (kind) {
    case "review_request_pending":
      return "review_assigned" as const;
    case "review_completed":
      return "review_completed" as const;
    case "opportunity_advanced":
    case "opportunity_won":
    case "opportunity_lost":
    case "opportunity_no_bid":
    case "opportunity_due_soon":
      return "opportunity_review_completed" as const;
    case "proposal_created":
    case "proposal_advanced":
    case "proposal_section_overdue":
      return "review_assigned" as const;
    case "compliance_overdue":
      return "review_assigned" as const;
    case "audit_anomaly":
      return "review_assigned" as const;
    case "membership_invited":
    case "membership_disabled":
      return "solicitation_role_assigned" as const;
    case "comment_mentioned":
      return "review_comment_mentioned" as const;
    case "opportunity_reviewed":
      return "opportunity_review_completed" as const;
    case "solicitation_role_assigned":
      return "solicitation_role_assigned" as const;
    case "review_assignment_added":
      // Late-add reviewer notification — same inbox kind as the
      // initial review-start fan-out (`review_assigned`). The
      // distinction between initial fan-out and late-add lives in
      // the trigger event kind + rule, not in the inbox row.
      return "review_assigned" as const;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
