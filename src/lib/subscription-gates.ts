import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  subscriptionTiers,
  tenantSubscriptions,
  tenantUsageCounters,
  type TierFeatureFlags,
  type TierQuotas,
} from "@/db/schema";
import { log } from "@/lib/log";

/**
 * BL-16 Phase B-1 — runtime feature gates.
 *
 * `ensureFeature(orgId, key)` throws `FeatureGateError` when the
 * tenant's effective feature flag is `false`. Wire into the actions
 * that the tier model is supposed to gate (AI auto-draft, winner
 * analysis, bulk export, custom templates, API access). Server-only.
 *
 * "Effective" = the tier's `feature_flags.<key>` value, then
 * overridden by `tenant_subscription.custom_overrides.featureFlags.<key>`
 * if set. The override layer lets a sales rep flip a single feature
 * on for one tenant without bumping them to a higher tier.
 *
 * Safety contract:
 *   - If the tenant has no subscription row at all → deny everything.
 *     Phase A's backfill puts every existing org on Platinum so this
 *     path only hits if a future org somehow lands without going
 *     through onboarding's tier assignment.
 *   - If the tenant's tier id resolves to a row marked `active=false`
 *     → deny everything (the tier was retired; the org needs to be
 *     migrated before they can use features).
 *
 * Bypass for superadmins: callers can choose to skip the gate when a
 * superadmin is acting in support mode. Not implemented here yet —
 * BL-15 Phase B-2 "assume identity" is the right place to thread
 * that through.
 */

export class FeatureGateError extends Error {
  readonly featureKey: keyof TierFeatureFlags;
  readonly tierName: string | null;

  constructor(featureKey: keyof TierFeatureFlags, tierName: string | null) {
    super(
      tierName
        ? `Feature "${featureKey}" isn't included in the ${tierName} tier. Upgrade or contact support.`
        : `Feature "${featureKey}" isn't enabled for this organization.`,
    );
    this.name = "FeatureGateError";
    this.featureKey = featureKey;
    this.tierName = tierName;
  }
}

export type CurrentTier = {
  tierId: string;
  tierName: string;
  tierSlug: string;
  status: string;
  featureFlags: TierFeatureFlags;
  quotas: TierQuotas;
  /**
   * Per-tenant override layer. Undefined keys mean "fall back to tier
   * defaults"; defined keys override.
   */
  overrides: {
    featureFlags?: Partial<TierFeatureFlags>;
    quotas?: Partial<TierQuotas>;
  };
  /** Effective flags = tier × overrides. */
  effectiveFlags: TierFeatureFlags;
  /** Effective quotas = tier × overrides. */
  effectiveQuotas: TierQuotas;
};

/**
 * Returns the resolved tier + effective flags/quotas for an
 * organization, or `null` when the org has no subscription row.
 * Read-only — no audit row written (sensitive-read auditing on tier
 * data is deferred; it's superadmin-visible already).
 */
export async function getCurrentTier(
  organizationId: string,
): Promise<CurrentTier | null> {
  const [row] = await db
    .select({
      tierId: subscriptionTiers.id,
      tierName: subscriptionTiers.name,
      tierSlug: subscriptionTiers.slug,
      tierActive: subscriptionTiers.active,
      tierFeatureFlags: subscriptionTiers.featureFlags,
      tierQuotas: subscriptionTiers.quotas,
      status: tenantSubscriptions.status,
      overrides: tenantSubscriptions.customOverrides,
    })
    .from(tenantSubscriptions)
    .innerJoin(
      subscriptionTiers,
      eq(subscriptionTiers.id, tenantSubscriptions.tierId),
    )
    .where(eq(tenantSubscriptions.organizationId, organizationId))
    .limit(1);

  if (!row) return null;

  // Retired tier — return the row but the caller's ensureFeature path
  // will deny every feature. Surface the tier name in the error so the
  // operator knows what to upgrade.
  const overrides = (row.overrides ?? {}) as {
    featureFlags?: Partial<TierFeatureFlags>;
    quotas?: Partial<TierQuotas>;
  };

  const effectiveFlags: TierFeatureFlags = row.tierActive
    ? mergeFlags(row.tierFeatureFlags, overrides.featureFlags)
    : DENY_ALL_FLAGS;
  const effectiveQuotas: TierQuotas = mergeQuotas(
    row.tierQuotas,
    overrides.quotas,
  );

  return {
    tierId: row.tierId,
    tierName: row.tierName,
    tierSlug: row.tierSlug,
    status: row.status,
    featureFlags: row.tierFeatureFlags,
    quotas: row.tierQuotas,
    overrides,
    effectiveFlags,
    effectiveQuotas,
  };
}

/**
 * Throws `FeatureGateError` when the feature isn't enabled for the
 * tenant. Safe-by-default: no subscription row → deny.
 */
export async function ensureFeature(
  organizationId: string,
  key: keyof TierFeatureFlags,
): Promise<void> {
  try {
    const tier = await getCurrentTier(organizationId);
    if (!tier) {
      throw new FeatureGateError(key, null);
    }
    if (!tier.effectiveFlags[key]) {
      throw new FeatureGateError(key, tier.tierName);
    }
  } catch (err) {
    if (err instanceof FeatureGateError) throw err;
    // Unexpected DB / lookup failure: log and deny. Failing open would
    // leak gated features.
    log.error("[ensureFeature]", "lookup failed", {
      error: err,
      organizationId,
      key,
    });
    throw new FeatureGateError(key, null);
  }
}

const DENY_ALL_FLAGS: TierFeatureFlags = {
  aiAutoDraft: false,
  winnerAnalysis: false,
  complianceMatrix: false,
  bulkExport: false,
  apiAccess: false,
  customTemplates: false,
};

function mergeFlags(
  base: TierFeatureFlags,
  overrides: Partial<TierFeatureFlags> | undefined,
): TierFeatureFlags {
  if (!overrides) return base;
  return {
    aiAutoDraft: overrides.aiAutoDraft ?? base.aiAutoDraft,
    winnerAnalysis: overrides.winnerAnalysis ?? base.winnerAnalysis,
    complianceMatrix: overrides.complianceMatrix ?? base.complianceMatrix,
    bulkExport: overrides.bulkExport ?? base.bulkExport,
    apiAccess: overrides.apiAccess ?? base.apiAccess,
    customTemplates: overrides.customTemplates ?? base.customTemplates,
  };
}

function mergeQuotas(
  base: TierQuotas,
  overrides: Partial<TierQuotas> | undefined,
): TierQuotas {
  if (!overrides) return base;
  return {
    aiRequestsPerMonth:
      overrides.aiRequestsPerMonth ?? base.aiRequestsPerMonth,
    seatsIncluded: overrides.seatsIncluded ?? base.seatsIncluded,
    storageGb: overrides.storageGb ?? base.storageGb,
    proposalsPerMonth: overrides.proposalsPerMonth ?? base.proposalsPerMonth,
  };
}

// ─────────────────────────────────────────────────────────────────────
// BL-16 Phase B-3 — quota enforcement
// ─────────────────────────────────────────────────────────────────────

/**
 * Quota keys that map to monthly counter values in
 * `tenant_usage_counter`. Distinguished from `seatsIncluded` /
 * `storageGb` which are measured live from their source tables and
 * don't need a counter row.
 */
export type CounterQuotaKey =
  | "aiRequestsPerMonth"
  | "proposalsPerMonth";

export class QuotaExceededError extends Error {
  readonly quotaKey: CounterQuotaKey;
  readonly limit: number;
  readonly used: number;
  readonly tierName: string | null;

  constructor(
    quotaKey: CounterQuotaKey,
    limit: number,
    used: number,
    tierName: string | null,
  ) {
    super(
      tierName
        ? `Monthly quota "${quotaKey}" exceeded on the ${tierName} tier: ${used}/${limit} used. Upgrade or contact support.`
        : `Monthly quota "${quotaKey}" exceeded: ${used}/${limit} used.`,
    );
    this.name = "QuotaExceededError";
    this.quotaKey = quotaKey;
    this.limit = limit;
    this.used = used;
    this.tierName = tierName;
  }
}

/**
 * Returns the first-of-month + first-of-next-month boundaries (UTC)
 * for the current calendar period. New counter rows lazily appear
 * on the first `enforceQuota` call of each month.
 */
function currentMonthPeriod(now: Date = new Date()): {
  periodStart: Date;
  periodEnd: Date;
} {
  const periodStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );
  const periodEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );
  return { periodStart, periodEnd };
}

/**
 * Enforces a monthly quota and atomically increments the counter on
 * the same call. Returns silently when the quota is `0` (unlimited
 * semantics, Platinum) — no counter row is written in that case to
 * avoid pointless writes.
 *
 * Throws `QuotaExceededError` when `currentValue + delta > limit`.
 * The increment IS still applied when the check fails — over-quota
 * usage is recorded so admins can see how far past the limit a
 * tenant tried to push. If you don't want the over-quota counter
 * to advance, branch on the check before calling.
 *
 * Concurrency: relies on Postgres' atomic UPSERT
 * (`INSERT ... ON CONFLICT DO UPDATE SET value = ... + EXCLUDED.value
 * RETURNING value`). Two concurrent calls won't lose counts. The
 * race window for "both calls succeed when only one should fit
 * under the limit" still exists — that's accepted; quotas are
 * advisory ceilings, not strict transactional caps. If a tenant
 * sneaks one extra call through, they paid for the request and we
 * billed them; the gate's job is to refuse the NEXT one.
 *
 * Safe-by-default: any DB / lookup failure logs and throws
 * QuotaExceededError to deny the action. Same posture as
 * `ensureFeature`.
 */
export async function enforceQuota(
  organizationId: string,
  key: CounterQuotaKey,
  delta: number = 1,
): Promise<{ used: number; limit: number }> {
  if (delta <= 0) {
    return { used: 0, limit: 0 };
  }

  try {
    const tier = await getCurrentTier(organizationId);
    if (!tier) {
      throw new QuotaExceededError(key, 0, 0, null);
    }

    const limit = tier.effectiveQuotas[key];
    // Quota = 0 means unlimited (Platinum semantics). Skip the
    // counter increment entirely — saves a write on the hot path.
    if (limit === 0) {
      return { used: 0, limit: 0 };
    }

    const { periodStart, periodEnd } = currentMonthPeriod();

    // Atomic UPSERT. Postgres `INSERT ... ON CONFLICT DO UPDATE
    // SET value = tenant_usage_counter.value + EXCLUDED.value
    // RETURNING value`. Concurrent calls compose correctly.
    const [row] = await db
      .insert(tenantUsageCounters)
      .values({
        organizationId,
        key,
        periodStart,
        periodEnd,
        value: delta,
      })
      .onConflictDoUpdate({
        target: [
          tenantUsageCounters.organizationId,
          tenantUsageCounters.key,
          tenantUsageCounters.periodStart,
        ],
        set: {
          value: sql`${tenantUsageCounters.value} + ${delta}`,
          updatedAt: new Date(),
        },
      })
      .returning({ value: tenantUsageCounters.value });

    const used = row?.value ?? delta;

    if (used > limit) {
      throw new QuotaExceededError(key, limit, used, tier.tierName);
    }

    return { used, limit };
  } catch (err) {
    if (err instanceof QuotaExceededError) throw err;
    log.error("[enforceQuota]", "lookup/upsert failed", {
      error: err,
      organizationId,
      key,
      delta,
    });
    throw new QuotaExceededError(key, 0, 0, null);
  }
}

/**
 * Read-only counter peek. Returns `0` if no row exists yet for the
 * current period. Used by admin dashboards that want to surface
 * "you've used X of Y this month" without incrementing.
 */
export async function getCurrentUsage(
  organizationId: string,
  key: CounterQuotaKey,
): Promise<number> {
  const { periodStart } = currentMonthPeriod();
  const [row] = await db
    .select({ value: tenantUsageCounters.value })
    .from(tenantUsageCounters)
    .where(
      and(
        eq(tenantUsageCounters.organizationId, organizationId),
        eq(tenantUsageCounters.key, key),
        eq(tenantUsageCounters.periodStart, periodStart),
      ),
    )
    .limit(1);
  return row?.value ?? 0;
}
