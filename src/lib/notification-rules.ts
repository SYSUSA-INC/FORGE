/**
 * BL-13 — notification rules engine.
 *
 * Pipeline:
 *   1. fireEvent(eventKind, payload)            ← call from anywhere
 *   2. engine looks up matching active rules for the org
 *   3. evaluates `matchFilter` against the payload
 *   4. resolves recipients via the rule's strategy
 *   5. for each (rule × recipient × channel), creates a
 *      `notification_delivery` row in 'pending' status
 *   6. for 'immediate' frequency rules, dispatches inline
 *      (in-app + email)
 *   7. for batched frequencies, the row stays pending until a
 *      scheduled job picks it up — see runScheduledNotifications()
 *
 * Failures inside fireEvent never throw — like recordAudit, this is
 * a side-channel. A broken notification rule shouldn't break the
 * user-facing action that triggered the event.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  memberships,
  notificationDeliveries,
  notificationRules,
  notifications,
  users,
  type NotificationRule,
  type NotificationRuleEventKind,
} from "@/db/schema";
import { sendEmail } from "@/lib/email";
import { log } from "@/lib/log";

// ────────────────────────────────────────────────────────────────────
// Event payloads
// ────────────────────────────────────────────────────────────────────

/**
 * Event payload shapes per kind. Adding a new event kind:
 *   1. Extend `notificationRuleEventKindEnum` in schema
 *   2. Add the payload shape here
 *   3. Add a render function below to produce subject + body
 *   4. Call `fireNotificationEvent` from the action that triggers it
 */
export type NotificationEventPayload =
  | {
      kind: "opportunity_due_soon";
      organizationId: string;
      opportunityId: string;
      ownerUserId: string | null;
      title: string;
      agency: string;
      dueDate: string;
      daysToDue: number;
    }
  | {
      kind: "proposal_section_overdue";
      organizationId: string;
      proposalId: string;
      sectionId: string;
      sectionTitle: string;
      proposalTitle: string;
      proposalManagerUserId: string | null;
      ownerUserId: string | null;
      daysOverdue: number;
    }
  | {
      kind: "review_request_pending";
      organizationId: string;
      reviewRequestId: string;
      opportunityId: string;
      opportunityTitle: string;
      reviewerEmail: string;
      senderUserId: string | null;
      hoursPending: number;
    }
  | {
      kind: "audit_anomaly";
      organizationId: string;
      auditAction: string;
      actorUserId: string | null;
      ipAddress: string;
      reason: string;
    }
  | {
      kind: "opportunity_stage_advance";
      organizationId: string;
      opportunityId: string;
      ownerUserId: string | null;
      title: string;
      fromStage: string;
      toStage: string;
    }
  | {
      kind: "proposal_stage_advance";
      organizationId: string;
      proposalId: string;
      proposalManagerUserId: string | null;
      ownerUserId: string | null;
      title: string;
      fromStage: string;
      toStage: string;
    }
  | {
      kind: "solicitation_review_complete";
      organizationId: string;
      solicitationId: string;
      title: string;
      requirementCount: number;
      stubbed: boolean;
    };

// ────────────────────────────────────────────────────────────────────
// Render — produce subject + body + linkPath per event
// ────────────────────────────────────────────────────────────────────

type RenderedMessage = { subject: string; body: string; linkPath: string };

function renderMessage(payload: NotificationEventPayload): RenderedMessage {
  switch (payload.kind) {
    case "opportunity_due_soon":
      return {
        subject: `Due in ${payload.daysToDue} day${payload.daysToDue === 1 ? "" : "s"}: ${payload.title}`,
        body: `${payload.agency} — response due ${payload.dueDate}.`,
        linkPath: `/opportunities/${payload.opportunityId}`,
      };
    case "proposal_section_overdue":
      return {
        subject: `Section "${payload.sectionTitle}" is ${payload.daysOverdue}d overdue`,
        body: `Proposal: ${payload.proposalTitle}.`,
        linkPath: `/proposals/${payload.proposalId}/sections`,
      };
    case "review_request_pending":
      return {
        subject: `Review request still pending for ${payload.opportunityTitle}`,
        body: `Sent to ${payload.reviewerEmail}, no response in ${payload.hoursPending}h.`,
        linkPath: `/opportunities/${payload.opportunityId}`,
      };
    case "audit_anomaly":
      return {
        subject: `Audit anomaly: ${payload.auditAction}`,
        body: `${payload.reason}${payload.ipAddress ? ` (IP ${payload.ipAddress})` : ""}.`,
        linkPath: `/audit-log`,
      };
    case "opportunity_stage_advance":
      return {
        subject: `${payload.title} — ${payload.fromStage} → ${payload.toStage}`,
        body: `Opportunity stage advanced.`,
        linkPath: `/opportunities/${payload.opportunityId}`,
      };
    case "proposal_stage_advance":
      return {
        subject: `${payload.title} — ${payload.fromStage} → ${payload.toStage}`,
        body: `Proposal stage advanced.`,
        linkPath: `/proposals/${payload.proposalId}`,
      };
    case "solicitation_review_complete":
      return {
        subject: `AI review complete: ${payload.title}`,
        body: `${payload.requirementCount} requirements extracted${payload.stubbed ? " (stub mode)" : ""}.`,
        linkPath: `/solicitations/${payload.solicitationId}`,
      };
  }
}

// ────────────────────────────────────────────────────────────────────
// Match-filter evaluator
// ────────────────────────────────────────────────────────────────────

/**
 * Shallow equality check between match filter and payload. Each key
 * in the filter must match the same key in the payload. Empty
 * filter matches every event of the kind.
 *
 * Future: support comparators ($gte, $lt) and array membership ($in).
 * Today's filters are simple string/number/boolean equality.
 */
function evaluateMatchFilter(
  filter: Record<string, unknown>,
  payload: NotificationEventPayload,
): boolean {
  if (Object.keys(filter).length === 0) return true;
  const obj = payload as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(filter)) {
    if (obj[key] !== value) return false;
  }
  return true;
}

// ────────────────────────────────────────────────────────────────────
// Recipient resolver
// ────────────────────────────────────────────────────────────────────

async function resolveRecipients(
  rule: NotificationRule,
  payload: NotificationEventPayload,
): Promise<string[]> {
  const ids = new Set<string>();

  switch (rule.recipientStrategy) {
    case "specific_users":
      for (const id of rule.recipientUserIds) ids.add(id);
      break;

    case "role": {
      // Members of the org with one of the configured roles.
      if (rule.recipientRoles.length === 0) break;
      const rows = await db
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, payload.organizationId),
            eq(memberships.status, "active"),
          ),
        );
      const allowedRoles = new Set(rule.recipientRoles);
      // memberships.role is a string column; we filter in code
      // because the array @> operator on text[] requires a less
      // ergonomic query.
      const roleRows = await db
        .select({
          userId: memberships.userId,
          role: memberships.role,
        })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, payload.organizationId),
            eq(memberships.status, "active"),
          ),
        );
      void rows;
      for (const r of roleRows) {
        if (allowedRoles.has(r.role)) ids.add(r.userId);
      }
      break;
    }

    case "all_admins": {
      const rows = await db
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, payload.organizationId),
            eq(memberships.status, "active"),
            eq(memberships.role, "admin"),
          ),
        );
      for (const r of rows) ids.add(r.userId);
      break;
    }

    case "proposal_owner": {
      // Walk the payload for a proposalManagerUserId or ownerUserId
      // — both common shapes across our payloads.
      const obj = payload as unknown as Record<string, string | null>;
      const candidate = obj.proposalManagerUserId ?? obj.ownerUserId ?? null;
      if (candidate) ids.add(candidate);
      break;
    }

    case "opportunity_owner": {
      const obj = payload as unknown as Record<string, string | null>;
      const candidate = obj.ownerUserId ?? null;
      if (candidate) ids.add(candidate);
      break;
    }
  }

  return [...ids];
}

// ────────────────────────────────────────────────────────────────────
// Dispatch — write the in-app notification + queue email
// ────────────────────────────────────────────────────────────────────

async function dispatchInApp(
  organizationId: string,
  recipientUserId: string,
  rendered: RenderedMessage,
  payload: NotificationEventPayload,
): Promise<{ ok: true; notificationId: string } | { ok: false; error: string }> {
  try {
    // Map the rule kind → existing notification_kind enum where possible.
    // For events that don't have an existing notification_kind, use
    // "review_completed" as a generic catch-all so the in-app feed
    // surfaces it. The kind enum can be extended in a separate
    // migration without blocking BL-13.
    const kindMap: Record<NotificationRuleEventKind, string> = {
      opportunity_due_soon: "review_completed",
      proposal_section_overdue: "review_completed",
      review_request_pending: "review_completed",
      audit_anomaly: "review_completed",
      opportunity_stage_advance: "review_completed",
      proposal_stage_advance: "review_completed",
      solicitation_review_complete: "review_completed",
    };

    const [row] = await db
      .insert(notifications)
      .values({
        organizationId,
        recipientUserId,
        // The cast here is safe — kindMap values are valid enum values.
        kind: kindMap[payload.kind] as
          | "review_assigned"
          | "review_section_assigned"
          | "review_comment_mentioned"
          | "review_completed"
          | "opportunity_review_completed"
          | "solicitation_role_assigned",
        subject: rendered.subject,
        body: rendered.body,
        linkPath: rendered.linkPath,
      })
      .returning({ id: notifications.id });
    if (!row) return { ok: false, error: "Could not write in-app notification." };
    return { ok: true, notificationId: row.id };
  } catch (err) {
    log.error("[notification-rules]", "in-app dispatch failed", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "In-app dispatch failed.",
    };
  }
}

async function dispatchEmail(
  recipientUserId: string,
  rendered: RenderedMessage,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, recipientUserId))
      .limit(1);
    if (!user) return { ok: false, error: "Recipient user not found." };

    await sendEmail({
      to: user.email,
      subject: rendered.subject,
      html: `<p>${escapeHtml(rendered.body)}</p><p><a href="${escapeHtml(rendered.linkPath)}">Open in FORGE →</a></p>`,
      text: `${rendered.body}\n\nOpen in FORGE: ${rendered.linkPath}`,
    });
    return { ok: true };
  } catch (err) {
    log.error("[notification-rules]", "email dispatch failed", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Email dispatch failed.",
    };
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ────────────────────────────────────────────────────────────────────
// Main entry point
// ────────────────────────────────────────────────────────────────────

/**
 * Fire an event into the rules engine. Loads matching rules for
 * the org, evaluates filters, resolves recipients, creates delivery
 * rows, and dispatches immediately for `immediate` frequency rules.
 *
 * Best-effort: errors swallow and log. The user-facing action that
 * called fireNotificationEvent must not be blocked by notification
 * machinery.
 */
export async function fireNotificationEvent(
  payload: NotificationEventPayload,
): Promise<void> {
  try {
    const matchingRules = await db
      .select()
      .from(notificationRules)
      .where(
        and(
          eq(notificationRules.organizationId, payload.organizationId),
          eq(notificationRules.eventKind, payload.kind),
          eq(notificationRules.active, true),
        ),
      );

    if (matchingRules.length === 0) return;

    const rendered = renderMessage(payload);

    for (const rule of matchingRules) {
      if (!evaluateMatchFilter(rule.matchFilter, payload)) continue;
      const recipients = await resolveRecipients(rule, payload);
      if (recipients.length === 0) continue;

      const slaDueAt =
        rule.slaSeconds > 0
          ? new Date(Date.now() + rule.slaSeconds * 1000)
          : null;

      for (const recipientUserId of recipients) {
        for (const channel of rule.channels) {
          // Create the delivery row up front so we have a paper
          // trail even if dispatch fails.
          const [delivery] = await db
            .insert(notificationDeliveries)
            .values({
              organizationId: payload.organizationId,
              ruleId: rule.id,
              recipientUserId,
              channel,
              subject: rendered.subject,
              body: rendered.body,
              linkPath: rendered.linkPath,
              slaDueAt,
            })
            .returning({ id: notificationDeliveries.id });
          if (!delivery) continue;

          // Immediate frequency dispatches inline; batched waits
          // for the scheduled processor.
          if (rule.frequency !== "immediate") continue;

          if (channel === "in_app") {
            const res = await dispatchInApp(
              payload.organizationId,
              recipientUserId,
              rendered,
              payload,
            );
            if (res.ok) {
              await db
                .update(notificationDeliveries)
                .set({
                  status: "sent",
                  sentAt: new Date(),
                  notificationId: res.notificationId,
                  updatedAt: new Date(),
                })
                .where(eq(notificationDeliveries.id, delivery.id));
            } else {
              await db
                .update(notificationDeliveries)
                .set({
                  status: "failed",
                  error: res.error.slice(0, 1000),
                  updatedAt: new Date(),
                })
                .where(eq(notificationDeliveries.id, delivery.id));
            }
          } else if (channel === "email") {
            const res = await dispatchEmail(recipientUserId, rendered);
            if (res.ok) {
              await db
                .update(notificationDeliveries)
                .set({
                  status: "sent",
                  sentAt: new Date(),
                  updatedAt: new Date(),
                })
                .where(eq(notificationDeliveries.id, delivery.id));
            } else {
              await db
                .update(notificationDeliveries)
                .set({
                  status: "failed",
                  error: res.error.slice(0, 1000),
                  updatedAt: new Date(),
                })
                .where(eq(notificationDeliveries.id, delivery.id));
            }
          }
          // Future channels (slack, teams) drop into a "pending"
          // delivery row but no inline dispatch — they're processed
          // by a separate worker.
        }
      }
    }
  } catch (err) {
    log.error("[fireNotificationEvent]", "engine error", {
      error: err,
      kind: payload.kind,
    });
  }
}

// ────────────────────────────────────────────────────────────────────
// Acknowledge — called when the user opens / dismisses the notification
// ────────────────────────────────────────────────────────────────────

/**
 * Mark a delivery acknowledged. Linked from the in-app notification
 * read flow; clearing the SLA breach risk.
 */
export async function acknowledgeDelivery(
  notificationId: string,
): Promise<void> {
  try {
    await db
      .update(notificationDeliveries)
      .set({ status: "acknowledged", ackedAt: new Date(), updatedAt: new Date() })
      .where(eq(notificationDeliveries.notificationId, notificationId));
  } catch (err) {
    log.warn("[acknowledgeDelivery]", "failed", { error: err });
  }
}
