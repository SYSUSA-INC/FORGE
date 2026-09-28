/**
 * BL-TIER-ASSIGN — a tenant's subscription row, created and changed in
 * one place.
 *
 * Migration 0043 put every organization that existed at the time on
 * Platinum, and the admin manual promised new organizations the same;
 * no onboarding path ever inserted the row. A tenant created since then
 * showed "No tier" on /admin/orgs/[id], the tier dropdown was hidden
 * (it only rendered for tenants that already had a tier) and the
 * change action refused ("Tenant has no subscription row"), so a
 * platform admin had no way to assign one.
 *
 *   ensureTenantSubscription — every onboarding path calls it after the
 *                              organization insert; puts a new tenant on
 *                              the default tier (Platinum, else the
 *                              first active tier). Best-effort: never
 *                              fails onboarding.
 *   assignTenantTier         — the superadmin change / first assignment;
 *                              inserts the row when there is none,
 *                              audited as tenant.tier_change with a null
 *                              fromTier on first assignment.
 *
 * Server-only; callers own auth. Every write carries organizationId.
 */
import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { subscriptionTiers, tenantSubscriptions } from "@/db/schema";
import { recordAudit } from "@/lib/audit-log";
import { log } from "@/lib/log";

export const DEFAULT_TIER_SLUG = "platinum";

type TierRef = { id: string; name: string; slug: string };

/** The tier a new tenant lands on: Platinum, else the first active tier. */
export async function resolveDefaultTier(): Promise<TierRef | null> {
  const [preferred] = await db
    .select({ id: subscriptionTiers.id, name: subscriptionTiers.name, slug: subscriptionTiers.slug })
    .from(subscriptionTiers)
    .where(and(eq(subscriptionTiers.slug, DEFAULT_TIER_SLUG), eq(subscriptionTiers.active, true)))
    .limit(1);
  if (preferred) return preferred;
  const [first] = await db
    .select({ id: subscriptionTiers.id, name: subscriptionTiers.name, slug: subscriptionTiers.slug })
    .from(subscriptionTiers)
    .where(eq(subscriptionTiers.active, true))
    .orderBy(asc(subscriptionTiers.sortOrder))
    .limit(1);
  return first ?? null;
}

async function currentTierOf(organizationId: string): Promise<TierRef | null> {
  const [row] = await db
    .select({ id: subscriptionTiers.id, name: subscriptionTiers.name, slug: subscriptionTiers.slug })
    .from(tenantSubscriptions)
    .innerJoin(subscriptionTiers, eq(subscriptionTiers.id, tenantSubscriptions.tierId))
    .where(eq(tenantSubscriptions.organizationId, organizationId))
    .limit(1);
  return row ?? null;
}

/**
 * Create the subscription row for a tenant that has none. Returns what
 * happened; never throws (onboarding must not fail over a tier).
 */
export async function ensureTenantSubscription(input: {
  organizationId: string;
}): Promise<{ created: boolean; tier: TierRef | null }> {
  const { organizationId } = input;
  try {
    const existing = await currentTierOf(organizationId);
    if (existing) return { created: false, tier: existing };
    const tier = await resolveDefaultTier();
    if (!tier) {
      log.warn("[ensureTenantSubscription]", "no active tier to assign", { organizationId });
      return { created: false, tier: null };
    }
    await db
      .insert(tenantSubscriptions)
      .values({ organizationId, tierId: tier.id, status: "active" })
      .onConflictDoNothing();
    return { created: true, tier };
  } catch (err) {
    log.error("[ensureTenantSubscription]", "failed", { organizationId, error: err });
    return { created: false, tier: null };
  }
}

export type AssignTierResult =
  | { ok: true; created: boolean; fromTier: TierRef | null; toTier: TierRef }
  | { ok: false; error: string };

/**
 * Put a tenant on a tier: insert the row when the tenant has none,
 * otherwise change it. Refuses retired tiers and no-op changes.
 */
export async function assignTenantTier(input: {
  organizationId: string;
  tierId: string;
  actor: { userId: string | null; email?: string | null };
}): Promise<AssignTierResult> {
  const { organizationId } = input;

  const [tier] = await db
    .select({
      id: subscriptionTiers.id,
      name: subscriptionTiers.name,
      slug: subscriptionTiers.slug,
      active: subscriptionTiers.active,
    })
    .from(subscriptionTiers)
    .where(eq(subscriptionTiers.id, input.tierId))
    .limit(1);
  if (!tier) return { ok: false, error: "Target tier not found." };
  if (!tier.active) {
    return {
      ok: false,
      error: `Cannot assign tenants to retired tier "${tier.name}". Pick an active tier.`,
    };
  }

  const current = await currentTierOf(organizationId);
  if (current && current.id === tier.id) {
    return { ok: false, error: `Tenant is already on the ${tier.name} tier.` };
  }

  const now = new Date();
  if (current) {
    await db
      .update(tenantSubscriptions)
      .set({ tierId: tier.id, updatedAt: now })
      .where(eq(tenantSubscriptions.organizationId, organizationId));
  } else {
    await db
      .insert(tenantSubscriptions)
      .values({ organizationId, tierId: tier.id, status: "active" })
      .onConflictDoUpdate({
        target: tenantSubscriptions.organizationId,
        set: { tierId: tier.id, updatedAt: now },
      });
  }

  const toTier = { id: tier.id, name: tier.name, slug: tier.slug };
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "tenant.tier_change",
    resourceType: "tenant_subscription",
    resourceId: organizationId,
    metadata: { fromTier: current, toTier, firstAssignment: !current },
  });
  return { ok: true, created: !current, fromTier: current, toTier };
}
