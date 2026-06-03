"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  memberships,
  notificationRules,
  users,
  type NotificationChannel,
} from "@/db/schema";
import {
  requireAuth,
  requireCurrentOrg,
  requireOrgAdmin,
} from "@/lib/auth-helpers";
import { recordAudit } from "@/lib/audit-log";
import { log } from "@/lib/log";
import {
  RuleInputSchema,
  type RuleInput,
} from "@/lib/notification-rules-validation";

// ─────────────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────────────

// Two return shapes used across the actions. Kept non-generic to
// avoid the `Record<string, never>` default-intersection trap where
// `{ ok: true }` fails to satisfy the empty index signature.
export type MutationResult = { ok: true } | { ok: false; error: string };
export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export type LoadedRule = {
  id: string;
  name: string;
  description: string;
  triggerEventKind: string;
  matchFilter: Record<string, unknown>;
  recipientStrategy: string;
  recipientConfig: Record<string, unknown>;
  channels: NotificationChannel[];
  frequency: string;
  slaSeconds: number | null;
  escalationStrategy: {
    strategy: string;
    config: Record<string, unknown>;
  } | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type OrgUserOption = {
  id: string;
  name: string | null;
  email: string;
};

// Internal helper — translate validated zod input into the row shape.
function toRow(input: RuleInput) {
  return {
    name: input.name,
    description: input.description,
    triggerEventKind: input.triggerEventKind,
    matchFilter: input.matchFilter,
    recipientStrategy: input.recipient.strategy,
    recipientConfig: input.recipient.config as Record<string, unknown>,
    channels: input.channels,
    frequency: input.frequency,
    slaSeconds: input.slaSeconds && input.slaSeconds > 0 ? input.slaSeconds : null,
    escalationStrategy:
      input.escalation && input.escalation.strategy
        ? { strategy: input.escalation.strategy, config: input.escalation.config }
        : null,
    active: input.active,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────

/**
 * Load a single rule for the editor page. Admin-only — non-admin
 * gets redirected by the requireOrgAdmin auth helper.
 */
export async function getNotificationRuleAction(
  id: string,
): Promise<LoadedRule | null> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const [row] = await db
    .select()
    .from(notificationRules)
    .where(
      and(
        eq(notificationRules.id, id),
        eq(notificationRules.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    triggerEventKind: row.triggerEventKind,
    matchFilter: row.matchFilter,
    recipientStrategy: row.recipientStrategy,
    recipientConfig: row.recipientConfig,
    channels: row.channels,
    frequency: row.frequency,
    slaSeconds: row.slaSeconds,
    escalationStrategy: row.escalationStrategy,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Org members eligible to receive notifications via the
 * specific_users recipient strategy. Used by the editor's user
 * picker.
 */
export async function listOrgUsersForRecipientPickerAction(): Promise<
  OrgUserOption[]
> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
    })
    .from(users)
    .innerJoin(memberships, eq(memberships.userId, users.id))
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.status, "active"),
      ),
    )
    .orderBy(asc(users.name), asc(users.email));

  return rows;
}

// ─────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────

export async function createNotificationRuleAction(
  raw: unknown,
): Promise<CreateResult> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const parsed = RuleInputSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first ? `${first.path.join(".")}: ${first.message}` : "Invalid rule.",
    };
  }

  try {
    const [row] = await db
      .insert(notificationRules)
      .values({
        organizationId,
        createdByUserId: actor.id,
        ...toRow(parsed.data),
      })
      .returning({ id: notificationRules.id });

    if (!row) return { ok: false, error: "Could not create rule." };

    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "notification_rule.create",
      resourceType: "notification_rule",
      resourceId: row.id,
      metadata: {
        name: parsed.data.name,
        triggerEventKind: parsed.data.triggerEventKind,
        recipientStrategy: parsed.data.recipient.strategy,
        channels: parsed.data.channels,
      },
    });

    revalidatePath("/notifications/rules");
    return { ok: true, id: row.id };
  } catch (err) {
    log.error("[createNotificationRuleAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Create failed.",
    };
  }
}

export async function updateNotificationRuleAction(
  id: string,
  raw: unknown,
): Promise<MutationResult> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  const parsed = RuleInputSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: first ? `${first.path.join(".")}: ${first.message}` : "Invalid rule.",
    };
  }

  try {
    await db
      .update(notificationRules)
      .set({ ...toRow(parsed.data), updatedAt: new Date() })
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
      metadata: {
        fields: [
          "name",
          "description",
          "triggerEventKind",
          "matchFilter",
          "recipient",
          "channels",
          "frequency",
          "slaSeconds",
          "escalation",
          "active",
        ],
      },
    });

    revalidatePath("/notifications/rules");
    revalidatePath(`/notifications/rules/${id}`);
    return { ok: true };
  } catch (err) {
    log.error("[updateNotificationRuleAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Update failed.",
    };
  }
}

export async function setNotificationRuleActiveAction(
  id: string,
  active: boolean,
): Promise<MutationResult> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  try {
    await db
      .update(notificationRules)
      .set({ active, updatedAt: new Date() })
      .where(
        and(
          eq(notificationRules.id, id),
          eq(notificationRules.organizationId, organizationId),
        ),
      );

    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: active
        ? "notification_rule.activate"
        : "notification_rule.deactivate",
      resourceType: "notification_rule",
      resourceId: id,
      metadata: { active },
    });

    revalidatePath("/notifications/rules");
    revalidatePath(`/notifications/rules/${id}`);
    return { ok: true };
  } catch (err) {
    log.error("[setNotificationRuleActiveAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Update failed.",
    };
  }
}

export async function deleteNotificationRuleAction(
  id: string,
): Promise<MutationResult> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  try {
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
  } catch (err) {
    log.error("[deleteNotificationRuleAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Delete failed.",
    };
  }
}

/**
 * BL-13 Phase E-1 — "Test send" for a notification rule.
 *
 * Fires a single sample dispatch event for the rule's trigger kind
 * so the admin can verify recipients + channels are wired correctly
 * without waiting for a real trigger. Uses a stubbed payload tagged
 * with `testSend: true` in metadata so audit / dispatch trails can
 * be filtered.
 *
 * Subject/body explicitly call out that this is a test message so
 * recipients don't mistake it for a real notification.
 */
export async function testSendNotificationRuleAction(
  ruleId: string,
): Promise<MutationResult> {
  const actor = await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  await requireOrgAdmin(organizationId);

  try {
    // Load the rule to confirm it exists + belongs to this org +
    // recover the trigger kind to dispatch with.
    const [rule] = await db
      .select({
        id: notificationRules.id,
        name: notificationRules.name,
        triggerEventKind: notificationRules.triggerEventKind,
        active: notificationRules.active,
      })
      .from(notificationRules)
      .where(
        and(
          eq(notificationRules.id, ruleId),
          eq(notificationRules.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (!rule) return { ok: false, error: "Rule not found." };
    if (!rule.active) {
      return {
        ok: false,
        error: "Rule is inactive. Activate it before sending a test.",
      };
    }

    // Lazy import to avoid pulling the dispatcher into every server-
    // action import graph just for one call site.
    const { dispatchTriggerEvent } = await import(
      "@/lib/notification-dispatcher"
    );
    await dispatchTriggerEvent({
      organizationId,
      kind: rule.triggerEventKind,
      // Tag the payload so downstream filtering / debugging can tell
      // test deliveries from real ones. The match_filter on the rule
      // would normally fire on real payload keys; for a test we want
      // the rule to match regardless of match_filter, so we pass an
      // empty payload (any filter with required keys won't match —
      // accepted limitation for test sends; admin can use real
      // triggers to exercise filter logic).
      payload: { testSend: true, ruleId: rule.id },
      subject: `[Test send] ${rule.name}`,
      body:
        `This is a test notification dispatched from ` +
        `${actor.email ?? actor.name ?? "an admin"}. ` +
        `It exercises the recipient + channel configuration of the rule "${rule.name}" ` +
        `but doesn't reflect a real ${rule.triggerEventKind} event.`,
      linkPath: `/notifications/rules/${rule.id}`,
      actorUserId: actor.id,
    });

    await recordAudit({
      organizationId,
      actor: { userId: actor.id, email: actor.email },
      action: "notification_rule.test_send",
      resourceType: "notification_rule",
      resourceId: rule.id,
      metadata: {
        name: rule.name,
        triggerEventKind: rule.triggerEventKind,
      },
    });

    return { ok: true };
  } catch (err) {
    log.error("[testSendNotificationRuleAction]", "error", { error: err });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Test send failed.",
    };
  }
}
