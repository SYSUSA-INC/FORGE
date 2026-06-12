import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  subscriptionTiers,
  tenantSubscriptions,
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
