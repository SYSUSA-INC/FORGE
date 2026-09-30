/**
 * BL-AIP-7c — the AI Engine control panel, server side.
 *
 * A tenant admin can now see and steer what the AI gateway does for
 * their organization:
 *
 *   state    — the tier's caps, the platform's overrides, the tenant's
 *              own budget, and month-to-date use of tokens and requests.
 *   usage    — month-to-date calls / tokens / errors per feature and
 *              tokens per day, from ai_call_log.
 *   routing  — `setAiFeatureRouting` stores a model *class* per feature
 *              in `customOverrides.aiModels`; the gateway resolves the
 *              class through the provider table (BL-AI-ROUTING). A
 *              literal model there was pinned by a platform admin and
 *              stays read-only for the tenant.
 *   budget   — `setAiBudget` stores the tenant's monthly ceiling in
 *              `customOverrides.aiBudget`; `getCurrentTier` applies it,
 *              so the existing gates refuse calls past it. It can only
 *              lower the tier's cap.
 *
 * Every read and write carries organizationId. Server-only; callers
 * own auth (org admin for the writes).
 */
import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiCallLogs, tenantSubscriptions } from "@/db/schema";
import { getAIProviderStatus, type AIProviderName } from "@/lib/ai";
import { sanitizeBudget, type AiBudget } from "@/lib/ai-control";
import { AI_FEATURES, type AiFeature } from "@/lib/ai-features";
import { isModelClass, routingEnabled, type AiModelClass } from "@/lib/ai-routing";
import { getAiFeatureBreakdown, type AiFeatureBreakdownRow } from "@/lib/ai-telemetry";
import { recordAudit } from "@/lib/audit-log";
import { getCurrentTier, getCurrentUsage } from "@/lib/subscription-gates";

type Actor = { userId: string | null; email?: string | null };

export type AiControlState = {
  hasSubscription: boolean;
  tierName: string | null;
  /** Tier × platform overrides, before the tenant's budget. 0 = unlimited. */
  platformTokenCap: number;
  platformRequestCap: number;
  /** After the tenant's budget. 0 = unlimited. */
  effectiveTokenCap: number;
  effectiveRequestCap: number;
  budget: AiBudget;
  aiModels: Record<string, string>;
  tokensUsed: number;
  requestsUsed: number;
  provider: AIProviderName;
  routingOn: boolean;
};

export async function getAiControlState(input: { organizationId: string }): Promise<AiControlState> {
  const { organizationId } = input;
  const tier = await getCurrentTier(organizationId);
  const [tokensUsed, requestsUsed] = await Promise.all([
    getCurrentUsage(organizationId, "aiTokensPerMonth"),
    getCurrentUsage(organizationId, "aiRequestsPerMonth"),
  ]);
  return {
    hasSubscription: tier !== null,
    tierName: tier?.tierName ?? null,
    platformTokenCap: tier?.platformQuotas.aiTokensPerMonth ?? 0,
    platformRequestCap: tier?.platformQuotas.aiRequestsPerMonth ?? 0,
    effectiveTokenCap: tier?.effectiveQuotas.aiTokensPerMonth ?? 0,
    effectiveRequestCap: tier?.effectiveQuotas.aiRequestsPerMonth ?? 0,
    budget: tier?.overrides.aiBudget ?? {},
    aiModels: tier?.overrides.aiModels ?? {},
    tokensUsed,
    requestsUsed,
    provider: getAIProviderStatus().active.name,
    routingOn: routingEnabled(),
  };
}

export type AiDailyUsage = { day: string; tokens: number; calls: number };

export type TenantAiUsage = {
  byFeature: AiFeatureBreakdownRow[];
  daily: AiDailyUsage[];
};

/** Month-to-date (or any window) usage of one tenant from ai_call_log. */
export async function getTenantAiUsage(input: {
  organizationId: string;
  since: Date;
}): Promise<TenantAiUsage> {
  const { organizationId } = input;
  const byFeature = await getAiFeatureBreakdown(input.since, organizationId);
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${aiCallLogs.createdAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
      tokens: sql<string>`coalesce(sum(${aiCallLogs.inputTokens} + ${aiCallLogs.outputTokens}), 0)`,
      calls: sql<string>`count(*)`,
    })
    .from(aiCallLogs)
    .where(and(eq(aiCallLogs.organizationId, organizationId), gte(aiCallLogs.createdAt, input.since)))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return {
    byFeature,
    daily: rows.map((r) => ({ day: r.day, tokens: Number(r.tokens), calls: Number(r.calls) })),
  };
}

export type AiControlResult = { ok: true } | { ok: false; error: string };

async function readOverrides(organizationId: string) {
  const [row] = await db
    .select({ overrides: tenantSubscriptions.customOverrides })
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.organizationId, organizationId))
    .limit(1);
  return row ? (row.overrides ?? {}) : null;
}

/**
 * Route one feature to a model class of the tenant's choosing, or back to
 * the tier default. A literal model pinned by a platform admin is never
 * changed from here.
 */
export async function setAiFeatureRouting(input: {
  organizationId: string;
  feature: string;
  value: "default" | AiModelClass;
  actor: Actor;
}): Promise<AiControlResult> {
  const { organizationId } = input;
  if (!(input.feature in AI_FEATURES)) return { ok: false, error: "Unknown AI feature." };
  if (input.value !== "default" && !isModelClass(input.value)) {
    return { ok: false, error: "Unknown model class." };
  }
  const feature = input.feature as AiFeature;

  const overrides = await readOverrides(organizationId);
  if (!overrides) return { ok: false, error: "This organization has no subscription yet." };
  const aiModels = { ...(overrides.aiModels ?? {}) };
  const current = aiModels[feature];
  if (typeof current === "string" && current.trim() && !isModelClass(current)) {
    return { ok: false, error: "This feature's model was pinned by a platform admin; ask them to change it." };
  }
  if (input.value === "default") delete aiModels[feature];
  else aiModels[feature] = input.value;

  await db
    .update(tenantSubscriptions)
    .set({ customOverrides: { ...overrides, aiModels }, updatedAt: new Date() })
    .where(eq(tenantSubscriptions.organizationId, organizationId));

  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "ai_engine.routing.update",
    resourceType: "tenant_subscription",
    resourceId: organizationId,
    metadata: { feature, from: current ?? null, to: input.value === "default" ? null : input.value },
  });
  return { ok: true };
}

/** Set the tenant's monthly ceiling; values at or above the tier cap clear it. */
export async function setAiBudget(input: {
  organizationId: string;
  budget: { tokensPerMonth?: unknown; requestsPerMonth?: unknown };
  actor: Actor;
}): Promise<AiControlResult & { budget?: AiBudget }> {
  const { organizationId } = input;
  const tier = await getCurrentTier(organizationId);
  if (!tier) return { ok: false, error: "This organization has no subscription yet." };
  const budget = sanitizeBudget(input.budget, tier.platformQuotas);

  const overrides = await readOverrides(organizationId);
  if (!overrides) return { ok: false, error: "This organization has no subscription yet." };
  const { aiBudget: previous, ...rest } = overrides;
  const next = Object.keys(budget).length === 0 ? rest : { ...rest, aiBudget: budget };

  await db
    .update(tenantSubscriptions)
    .set({ customOverrides: next, updatedAt: new Date() })
    .where(eq(tenantSubscriptions.organizationId, organizationId));

  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "ai_engine.budget.update",
    resourceType: "tenant_subscription",
    resourceId: organizationId,
    metadata: { from: previous ?? null, to: budget },
  });
  return { ok: true, budget };
}
