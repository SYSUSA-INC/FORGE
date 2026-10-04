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
import { TRIAL_DAYS, extendedTrialEnd, sanitizeTrialDays, trialEndFrom } from "@/lib/trial-logic";

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

// ── BL-AUTH-ABUSE Slice 2a — trials ──────────────────────────────────

export type TrialResult = { ok: true; trialUntil: Date | null } | { ok: false; error: string };
type Actor = { userId: string | null; email?: string | null };

async function subscriptionRow(organizationId: string) {
  const [row] = await db
    .select({ status: tenantSubscriptions.status, trialUntil: tenantSubscriptions.trialUntil, stripeSubscriptionId: tenantSubscriptions.stripeSubscriptionId })
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.organizationId, organizationId))
    .limit(1);
  return row ?? null;
}

/**
 * Put a workspace on a trial of `days` (default 14) from now. A workspace
 * with no subscription row gets one on the default tier first. Refused
 * for a workspace paying through Stripe and for one already on a trial
 * (extend that instead). Audited tenant.trial_start.
 */
export async function startTenantTrial(input: { organizationId: string; actor: Actor; days?: number; now?: Date }): Promise<TrialResult> {
  const { organizationId } = input;
  const days = input.days === undefined ? TRIAL_DAYS : sanitizeTrialDays(input.days);
  if (days === null) return { ok: false, error: "Trial length: a whole number of days from 1 to 90." };
  let row = await subscriptionRow(organizationId);
  if (!row) {
    const ensured = await ensureTenantSubscription({ organizationId });
    if (!ensured.tier) return { ok: false, error: "Assign a tier first — there is no active tier to start a trial on." };
    row = await subscriptionRow(organizationId);
    if (!row) return { ok: false, error: "Could not create the subscription row." };
  }
  if (row.stripeSubscriptionId) return { ok: false, error: "This workspace pays through Stripe; trials are for workspaces without a plan." };
  if (row.status === "trial") return { ok: false, error: "Already on a trial — extend it instead." };
  const trialUntil = trialEndFrom(input.now ?? new Date(), days);
  await db
    .update(tenantSubscriptions)
    .set({ status: "trial", trialUntil, updatedAt: new Date() })
    .where(eq(tenantSubscriptions.organizationId, organizationId));
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "tenant.trial_start",
    resourceType: "tenant_subscription",
    resourceId: organizationId,
    metadata: { days, trialUntil: trialUntil.toISOString(), fromStatus: row.status },
  });
  return { ok: true, trialUntil };
}

/**
 * Give a trial more time: `days` from the later of now and its current
 * end, so an ended trial restarts AI from today. Audited tenant.trial_extend.
 */
export async function extendTenantTrial(input: { organizationId: string; actor: Actor; days: number; now?: Date }): Promise<TrialResult> {
  const { organizationId } = input;
  const days = sanitizeTrialDays(input.days);
  if (days === null) return { ok: false, error: "Extension: a whole number of days from 1 to 90." };
  const row = await subscriptionRow(organizationId);
  if (!row || row.status !== "trial") return { ok: false, error: "This workspace is not on a trial." };
  const trialUntil = extendedTrialEnd(row.trialUntil, days, input.now ?? new Date());
  await db
    .update(tenantSubscriptions)
    .set({ trialUntil, updatedAt: new Date() })
    .where(and(eq(tenantSubscriptions.organizationId, organizationId), eq(tenantSubscriptions.status, "trial")));
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "tenant.trial_extend",
    resourceType: "tenant_subscription",
    resourceId: organizationId,
    metadata: { days, from: row.trialUntil?.toISOString() ?? null, to: trialUntil.toISOString() },
  });
  return { ok: true, trialUntil };
}

/**
 * End a trial by converting it to full access on its current tier (a
 * sales-led deal, or a plan arranged outside Stripe). A Stripe checkout
 * does the same through the webhook. Audited tenant.trial_convert.
 */
export async function convertTenantTrial(input: { organizationId: string; actor: Actor }): Promise<TrialResult> {
  const { organizationId } = input;
  const row = await subscriptionRow(organizationId);
  if (!row || row.status !== "trial") return { ok: false, error: "This workspace is not on a trial." };
  await db
    .update(tenantSubscriptions)
    .set({ status: "active", trialUntil: null, updatedAt: new Date() })
    .where(and(eq(tenantSubscriptions.organizationId, organizationId), eq(tenantSubscriptions.status, "trial")));
  await recordAudit({
    organizationId,
    actor: input.actor,
    action: "tenant.trial_convert",
    resourceType: "tenant_subscription",
    resourceId: organizationId,
    metadata: { endedTrialUntil: row.trialUntil?.toISOString() ?? null },
  });
  return { ok: true, trialUntil: null };
}
