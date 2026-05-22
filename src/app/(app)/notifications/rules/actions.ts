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
