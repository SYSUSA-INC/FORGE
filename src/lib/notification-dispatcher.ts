import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  notifications,
  notificationDeliveries,
  notificationRules,
  users,
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
 * Channel semantics:
 *   - in_app  → creates notification_delivery + notification rows
 *   - email   → BL-AIP-3: for immediate rules the email is sent here
 *               (src/lib/email.ts via Resend) and the delivery row
 *               records sent_at on success or `error` on failure; with no
 *               RESEND_API_KEY the row is marked with that error rather
 *               than pretending it was sent. Batched email is sent as a
 *               digest by the Phase D cron.
 *   - slack/teams → creates a delivery row with error="not implemented"
 *                   so the audit trail captures the gap
 *
 * Returns counts so callers that need to know (test send, crons) can
 * report honestly instead of assuming something went out.
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
  /**
   * BL-AIP-3 — restrict the dispatch to one rule. Test send uses it so a
   * test exercises the rule being edited, not every active rule of that
   * kind in the tenant.
   */
  onlyRuleId?: string;
};

export type DispatchResult = {
  /** Rules that matched the filter and resolved at least one recipient. */
  rulesMatched: number;
  /** Recipient × rule pairs (a user reached by two rules counts twice). */
  recipients: number;
  /** Delivery rows written. */
  deliveries: number;
  emailsSent: number;
  emailErrors: number;
};

const EMPTY_RESULT: DispatchResult = {
  rulesMatched: 0,
  recipients: 0,
  deliveries: 0,
  emailsSent: 0,
  emailErrors: 0,
};

export async function dispatchTriggerEvent(input: DispatchInput): Promise<DispatchResult> {
  const { organizationId, kind, payload } = input;
  const result: DispatchResult = { ...EMPTY_RESULT };
  try {
    const conditions = [
      eq(notificationRules.organizationId, organizationId),
      eq(notificationRules.triggerEventKind, kind),
      eq(notificationRules.active, true),
    ];
    if (input.onlyRuleId) conditions.push(eq(notificationRules.id, input.onlyRuleId));

    const rules = await db
      .select({
        id: notificationRules.id,
        name: notificationRules.name,
        matchFilter: notificationRules.matchFilter,
        recipientStrategy: notificationRules.recipientStrategy,
        recipientConfig: notificationRules.recipientConfig,
        channels: notificationRules.channels,
        frequency: notificationRules.frequency,
      })
      .from(notificationRules)
      .where(and(...conditions));

    if (rules.length === 0) return result;

    for (const rule of rules) {
      if (!matchFilterApplies(rule.matchFilter, payload)) continue;

      const recipientIds = await resolveRecipients({
        organizationId,
        strategy: rule.recipientStrategy,
        config: rule.recipientConfig,
        payload,
      });

      if (recipientIds.length === 0) continue;
      result.rulesMatched += 1;
      result.recipients += recipientIds.length;

      const isImmediate = rule.frequency === "immediate";
      const sentAt = isImmediate ? new Date() : null;

      // Build the delivery rows. One per (recipient × channel). Immediate
      // email rows start unsent; sendEmailDeliveries stamps them.
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
            sentAt: supported && channel !== "email" ? sentAt : null,
            error: supported ? "" : "channel not yet implemented",
          });
        }
      }

      if (deliveryRows.length === 0) continue;

      let inserted: { id: string; recipientUserId: string | null; channel: NotificationChannel }[];
      try {
        inserted = await db.insert(notificationDeliveries).values(deliveryRows).returning({
          id: notificationDeliveries.id,
          recipientUserId: notificationDeliveries.recipientUserId,
          channel: notificationDeliveries.channel,
        });
      } catch (err) {
        log.error("[dispatchTriggerEvent]", "delivery insert failed", {
          error: err,
          ruleId: rule.id,
          organizationId,
        });
        continue;
      }
      result.deliveries += inserted.length;

      // BL-AIP-3 — immediate email goes out now. Batched email waits for
      // the digest cron, which sends one email per recipient per cadence.
      if (isImmediate && rule.channels.includes("email")) {
        const emailRows = inserted.filter(
          (r): r is { id: string; recipientUserId: string; channel: NotificationChannel } =>
            r.channel === "email" && !!r.recipientUserId,
        );
        const sent = await sendEmailDeliveries({
          organizationId,
          rows: emailRows,
          subject: input.subject,
          body: input.body,
          linkPath: input.linkPath,
          ruleName: rule.name,
        });
        result.emailsSent += sent.sent;
        result.emailErrors += sent.failed;
      }

      // For immediate + in_app, also append a row to the legacy
      // `notification` table so it shows up in the user's inbox.
      // Batched in-app rows materialize via the Phase D cron.
      if (!isImmediate) continue;
      if (!rule.channels.includes("in_app")) continue;

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
  return result;
}

export const EMAIL_NOT_CONFIGURED_ERROR = "email not configured (RESEND_API_KEY)";

/**
 * Send one email per delivery row and stamp each row: `sent_at` on
 * success, `sent_at` + `error` on failure (an attempt was made; nothing
 * retries it, and leaving sent_at null would make the SLA cron ignore it
 * forever). Without a provider key every row gets the "not configured"
 * error so the rule's history shows the truth.
 */
async function sendEmailDeliveries(input: {
  organizationId: string;
  rows: { id: string; recipientUserId: string }[];
  subject: string;
  body?: string;
  linkPath?: string;
  ruleName: string;
}): Promise<{ sent: number; failed: number }> {
  const { organizationId } = input;
  if (input.rows.length === 0) return { sent: 0, failed: 0 };
  const ids = input.rows.map((r) => r.id);

  // Lazy import keeps Resend out of every action's import graph.
  const { emailConfigured, sendRuleNotificationEmail } = await import("@/lib/email");
  if (!emailConfigured()) {
    await db
      .update(notificationDeliveries)
      .set({ sentAt: new Date(), error: EMAIL_NOT_CONFIGURED_ERROR })
      .where(
        and(
          eq(notificationDeliveries.organizationId, organizationId),
          inArray(notificationDeliveries.id, ids),
        ),
      )
      .catch(() => undefined);
    return { sent: 0, failed: ids.length };
  }

  // Recipient ids were resolved within this tenant; `user` has no org
  // column, so the lookup is by id.
  const userRows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.id, input.rows.map((r) => r.recipientUserId)));
  const emailById = new Map(userRows.map((u) => [u.id, u.email]));

  let sent = 0;
  let failed = 0;
  for (const row of input.rows) {
    const to = emailById.get(row.recipientUserId);
    try {
      if (!to) throw new Error("recipient has no email address");
      await sendRuleNotificationEmail({
        to,
        subject: input.subject,
        body: input.body,
        linkPath: input.linkPath,
        ruleName: input.ruleName,
      });
      await db
        .update(notificationDeliveries)
        .set({ sentAt: new Date(), error: "" })
        .where(
          and(
            eq(notificationDeliveries.organizationId, organizationId),
            eq(notificationDeliveries.id, row.id),
          ),
        );
      sent += 1;
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      log.warn("[dispatchTriggerEvent]", "email send failed", { deliveryId: row.id, error: message });
      await db
        .update(notificationDeliveries)
        .set({ sentAt: new Date(), error: message.slice(0, 500) })
        .where(
          and(
            eq(notificationDeliveries.organizationId, organizationId),
            eq(notificationDeliveries.id, row.id),
          ),
        )
        .catch(() => undefined);
    }
  }
  return { sent, failed };
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
    case "proposal_section_assigned":
      // BL-AIP-3 — the inbox already has a kind for exactly this.
      return "review_section_assigned" as const;
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
