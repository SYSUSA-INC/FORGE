"use server";

import { and, asc, desc, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  memberships,
  notificationDeliveries,
  notificationRules,
  users,
  type NotificationFrequency,
  type NotificationRecipientStrategy,
  type NotificationRuleEventKind,
} from "@/db/schema";
import {
  requireAuth,
  requireCurrentOrg,
  requireOrgAdmin,
  requireSuperadmin,
} from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { fireNotificationEvent } from "@/lib/notification-rules";
import { log } from "@/lib/log";

// ────────────────────────────────────────────────────────────────────
// CRUD
// ────────────────────────────────────────────────────────────────────

export type RuleInput = {
  name: string;
  description: string;
  eventKind: NotificationRuleEventKind;
  matchFilter: Record<string, unknown>;
  recipientStrategy: NotificationRecipientStrategy;
  recipientUserIds: string[];
  recipientRoles: string[];
  channels: string[];
  frequency: NotificationFrequency;
  slaSeconds: number;
  escalationUserIds: string[];
  active: boolean;
};

const VALID_CHANNELS = new Set(["in_app", "email"]);

function validateInput(input: RuleInput): string | null {
  if (!input.name.trim()) return "Name is required.";
  if (input.channels.length === 0) {
    return "Pick at least one channel.";
  }
  for (const ch of input.channels) {
    if (!VALID_CHANNELS.has(ch)) return `Unsupported channel: ${ch}`;
  }
  if (input.recipientStrategy === "specific_users" && input.recipientUserIds.length === 0) {
    return "Pick at least one recipient.";
  }
  if (input.recipientStrategy === "role" && input.recipientRoles.length === 0) {
    return "Pick at least one role.";
  }
  if (input.slaSeconds < 0 || input.slaSeconds > 30 * 24 * 3600) {
    return "SLA must be between 0 and 30 days (in seconds).";
  }
  return null;
}

export type CreateRuleResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function createRuleAction(
  input: RuleInput,
): Promise<CreateRuleResult> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const err = validateInput(input);
  if (err) return { ok: false, error: err };

  try {
    const [row] = await db
      .insert(notificationRules)
      .values({
        organizationId,
        name: input.name.trim().slice(0, 256),
        description: input.description.trim().slice(0, 1000),
        eventKind: input.eventKind,
        matchFilter: input.matchFilter,
        recipientStrategy: input.recipientStrategy,
        recipientUserIds: input.recipientUserIds,
        recipientRoles: input.recipientRoles,
        channels: input.channels,
        frequency: input.frequency,
        slaSeconds: input.slaSeconds,
        escalationUserIds: input.escalationUserIds,
        active: input.active,
        createdByUserId: actor.id,
      })
      .returning({ id: notificationRules.id });
    if (!row) return { ok: false, error: "Could not save rule." };

    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "notification_rule.create",
      resourceType: "notification_rule",
      resourceId: row.id,
      metadata: {
        name: input.name,
        eventKind: input.eventKind,
        channels: input.channels,
      },
    });

    revalidatePath("/notifications/rules");
    return { ok: true, id: row.id };
  } catch (err) {
    log.error("[createRuleAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Save failed.",
    };
  }
}

export async function updateRuleAction(
  id: string,
  input: RuleInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const err = validateInput(input);
  if (err) return { ok: false, error: err };

  try {
    await db
      .update(notificationRules)
      .set({
        name: input.name.trim().slice(0, 256),
        description: input.description.trim().slice(0, 1000),
        eventKind: input.eventKind,
        matchFilter: input.matchFilter,
        recipientStrategy: input.recipientStrategy,
        recipientUserIds: input.recipientUserIds,
        recipientRoles: input.recipientRoles,
        channels: input.channels,
        frequency: input.frequency,
        slaSeconds: input.slaSeconds,
        escalationUserIds: input.escalationUserIds,
        active: input.active,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(notificationRules.id, id),
          eq(notificationRules.organizationId, organizationId),
        ),
      );

    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "notification_rule.update",
      resourceType: "notification_rule",
      resourceId: id,
      metadata: { name: input.name, active: input.active },
    });

    revalidatePath("/notifications/rules");
    return { ok: true };
  } catch (err) {
    log.error("[updateRuleAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Update failed.",
    };
  }
}

export async function deleteRuleAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  await db
    .delete(notificationRules)
    .where(
      and(
        eq(notificationRules.id, id),
        eq(notificationRules.organizationId, organizationId),
      ),
    );

  await recordAudit({
    organizationId,
    actor: { userId: actor.id, email: actor.email },
    action: "notification_rule.delete",
    resourceType: "notification_rule",
    resourceId: id,
  });

  revalidatePath("/notifications/rules");
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────
// Test send — fire a sample event so the user can verify delivery
// ────────────────────────────────────────────────────────────────────

export type TestSendResult =
  | { ok: true; deliveryCount: number }
  | { ok: false; error: string };

export async function testSendRuleAction(
  ruleId: string,
): Promise<TestSendResult> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const [rule] = await db
    .select()
    .from(notificationRules)
    .where(
      and(
        eq(notificationRules.id, ruleId),
        eq(notificationRules.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!rule) return { ok: false, error: "Rule not found." };

  // Construct a synthetic payload for the rule's event kind. Uses
  // dummy IDs so it's clear in the delivery log this was a test.
  const before = await db
    .select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.ruleId, ruleId));

  const stamp = new Date().toISOString().slice(0, 10);

  switch (rule.eventKind) {
    case "opportunity_due_soon":
      await fireNotificationEvent({
        kind: "opportunity_due_soon",
        organizationId,
        opportunityId: "00000000-0000-0000-0000-000000000000",
        ownerUserId: actor.id,
        title: "[TEST] Sample opportunity",
        agency: "Test Agency",
        dueDate: stamp,
        daysToDue: 3,
      });
      break;
    case "proposal_section_overdue":
      await fireNotificationEvent({
        kind: "proposal_section_overdue",
        organizationId,
        proposalId: "00000000-0000-0000-0000-000000000000",
        sectionId: "00000000-0000-0000-0000-000000000000",
        sectionTitle: "[TEST] Section",
        proposalTitle: "[TEST] Proposal",
        proposalManagerUserId: actor.id,
        ownerUserId: actor.id,
        daysOverdue: 2,
      });
      break;
    case "review_request_pending":
      await fireNotificationEvent({
        kind: "review_request_pending",
        organizationId,
        reviewRequestId: "00000000-0000-0000-0000-000000000000",
        opportunityId: "00000000-0000-0000-0000-000000000000",
        opportunityTitle: "[TEST] Opportunity",
        reviewerEmail: "reviewer@example.com",
        senderUserId: actor.id,
        hoursPending: 24,
      });
      break;
    case "audit_anomaly":
      await fireNotificationEvent({
        kind: "audit_anomaly",
        organizationId,
        auditAction: "test.event",
        actorUserId: actor.id,
        ipAddress: "127.0.0.1",
        reason: "[TEST] Synthetic anomaly",
      });
      break;
    case "opportunity_stage_advance":
      await fireNotificationEvent({
        kind: "opportunity_stage_advance",
        organizationId,
        opportunityId: "00000000-0000-0000-0000-000000000000",
        ownerUserId: actor.id,
        title: "[TEST] Sample opportunity",
        fromStage: "identified",
        toStage: "qualification",
      });
      break;
    case "proposal_stage_advance":
      await fireNotificationEvent({
        kind: "proposal_stage_advance",
        organizationId,
        proposalId: "00000000-0000-0000-0000-000000000000",
        proposalManagerUserId: actor.id,
        ownerUserId: actor.id,
        title: "[TEST] Sample proposal",
        fromStage: "draft",
        toStage: "pink_team",
      });
      break;
    case "solicitation_review_complete":
      await fireNotificationEvent({
        kind: "solicitation_review_complete",
        organizationId,
        solicitationId: "00000000-0000-0000-0000-000000000000",
        title: "[TEST] Sample solicitation",
        requirementCount: 12,
        stubbed: false,
      });
      break;
  }

  // Count new deliveries created by this fire.
  const after = await db
    .select({ id: notificationDeliveries.id })
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.ruleId, ruleId));

  const newCount = after.length - before.length;
  return { ok: true, deliveryCount: newCount };
}

// ────────────────────────────────────────────────────────────────────
// List rules + recent deliveries (read-only)
// ────────────────────────────────────────────────────────────────────

export type RuleRow = {
  id: string;
  name: string;
  description: string;
  eventKind: NotificationRuleEventKind;
  recipientStrategy: NotificationRecipientStrategy;
  recipientUserIds: string[];
  recipientRoles: string[];
  channels: string[];
  frequency: NotificationFrequency;
  slaSeconds: number;
  escalationUserIds: string[];
  active: boolean;
  matchFilter: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export async function listRulesAction(): Promise<RuleRow[]> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const rows = await db
    .select()
    .from(notificationRules)
    .where(eq(notificationRules.organizationId, organizationId))
    .orderBy(asc(notificationRules.eventKind), desc(notificationRules.updatedAt));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    eventKind: r.eventKind,
    recipientStrategy: r.recipientStrategy,
    recipientUserIds: r.recipientUserIds,
    recipientRoles: r.recipientRoles,
    channels: r.channels,
    frequency: r.frequency,
    slaSeconds: r.slaSeconds,
    escalationUserIds: r.escalationUserIds,
    active: r.active,
    matchFilter: r.matchFilter,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export type OrgUserRow = {
  id: string;
  name: string | null;
  email: string;
  role: string;
};

export async function listOrgUsersAction(): Promise<OrgUserRow[]> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: memberships.role,
    })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.status, "active"),
      ),
    )
    .orderBy(asc(users.name));

  return rows;
}

// ────────────────────────────────────────────────────────────────────
// Scheduled processor — handles SLA breach detection
// ────────────────────────────────────────────────────────────────────

/**
 * Scan for deliveries past their SLA due time that haven't been
 * acknowledged, mark them as breached, and dispatch the escalation
 * notification. Designed to be triggered by:
 *   - Vercel Cron (preferred — every 5 minutes)
 *   - GitHub Actions schedule
 *   - Manual trigger from /admin (debug)
 *
 * Idempotent: only acts on rows where slaBreachedAt IS NULL.
 *
 * Returns a structured summary of work done. Caller logs / surfaces
 * to its own UI as appropriate.
 */
export async function processSlaEscalationsAction(): Promise<{
  ok: true;
  breached: number;
  escalated: number;
}> {
  // Cross-tenant batch — superadmin-gated for now. Wire to Vercel
  // Cron when scheduling lands.
  await requireSuperadmin();
  const now = new Date();

  // Pull breach candidates.
  const candidates = await db
    .select()
    .from(notificationDeliveries)
    .where(
      and(
        isNull(notificationDeliveries.ackedAt),
        isNull(notificationDeliveries.slaBreachedAt),
        isNotNull(notificationDeliveries.slaDueAt),
        lte(notificationDeliveries.slaDueAt, now),
      ),
    )
    .limit(200);

  let escalated = 0;
  for (const delivery of candidates) {
    // Mark breached.
    await db
      .update(notificationDeliveries)
      .set({
        status: "sla_breached",
        slaBreachedAt: now,
        updatedAt: now,
      })
      .where(eq(notificationDeliveries.id, delivery.id));

    // Look up the rule to get escalation recipients.
    const [rule] = await db
      .select()
      .from(notificationRules)
      .where(eq(notificationRules.id, delivery.ruleId))
      .limit(1);
    if (!rule || rule.escalationUserIds.length === 0) continue;

    // Re-dispatch the same message to the escalation users.
    for (const escalateTo of rule.escalationUserIds) {
      await db.insert(notificationDeliveries).values({
        organizationId: delivery.organizationId,
        ruleId: rule.id,
        recipientUserId: escalateTo,
        channel: "in_app",
        subject: `[ESCALATION] ${delivery.subject}`,
        body: `SLA breached on the original notification — escalated to you for follow-up.\n\n${delivery.body}`,
        linkPath: delivery.linkPath,
        status: "pending",
      });
      escalated++;
    }
  }

  return { ok: true, breached: candidates.length, escalated };
}
