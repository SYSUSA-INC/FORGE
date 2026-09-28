/**
 * BL-TIER-ASSIGN — the tenant subscription row, against Postgres.
 *
 * Two tenants, neither with a subscription row (the fixture creates
 * none, like every onboarding path did before this). Asserts that
 * ensureTenantSubscription creates the row once on the default tier,
 * that assignTenantTier creates on the first call and changes on the
 * next, refuses the same tier and a retired tier, and that tenant B's
 * row is untouched by A's assignment.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, subscriptionTiers, tenantSubscriptions } from "@/db/schema";
import {
  assignTenantTier,
  ensureTenantSubscription,
  resolveDefaultTier,
} from "@/lib/tenant-subscription";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

async function rowOf(organizationId: string) {
  const [row] = await db
    .select({ tierId: tenantSubscriptions.tierId, status: tenantSubscriptions.status })
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.organizationId, organizationId))
    .limit(1);
  return row ?? null;
}

describe("BL-TIER-ASSIGN — tenant subscription", () => {
  let fx: TwoTenantFixture;
  let activeTierId: string;
  let retiredTierId: string;

  beforeEach(async () => {
    fx = await createTwoTenants("tier-assign");
    const tag = Date.now().toString(36);
    const [active] = await db
      .insert(subscriptionTiers)
      .values({ slug: `t-active-${tag}`, name: "Test active", active: true, sortOrder: 900 })
      .returning({ id: subscriptionTiers.id });
    const [retired] = await db
      .insert(subscriptionTiers)
      .values({ slug: `t-retired-${tag}`, name: "Test retired", active: false, sortOrder: 901 })
      .returning({ id: subscriptionTiers.id });
    activeTierId = active!.id;
    retiredTierId = retired!.id;
  });

  afterEach(async () => {
    await fx.cleanup();
    await db.delete(subscriptionTiers).where(inArray(subscriptionTiers.id, [activeTierId, retiredTierId]));
  });

  it("ensureTenantSubscription creates the row once, on the default tier", async () => {
    expect(await rowOf(fx.orgA.organizationId)).toBeNull();
    const first = await ensureTenantSubscription({ organizationId: fx.orgA.organizationId });
    const expected = await resolveDefaultTier();
    expect(expected).not.toBeNull();
    expect(first).toEqual({ created: true, tier: expected });
    expect(await rowOf(fx.orgA.organizationId)).toEqual({ tierId: expected!.id, status: "active" });

    const again = await ensureTenantSubscription({ organizationId: fx.orgA.organizationId });
    expect(again).toEqual({ created: false, tier: expected });
    expect(await rowOf(fx.orgB.organizationId)).toBeNull();
  });

  it("assignTenantTier creates on first assignment, changes afterwards, refuses no-ops and retired tiers", async () => {
    const actor = { userId: fx.orgA.userId, email: "admin@test" };
    const first = await assignTenantTier({
      organizationId: fx.orgA.organizationId,
      tierId: activeTierId,
      actor,
    });
    expect(first).toMatchObject({ ok: true, created: true, fromTier: null, toTier: { id: activeTierId } });
    expect(await rowOf(fx.orgA.organizationId)).toEqual({ tierId: activeTierId, status: "active" });

    const same = await assignTenantTier({ organizationId: fx.orgA.organizationId, tierId: activeTierId, actor });
    expect(same).toEqual({ ok: false, error: "Tenant is already on the Test active tier." });

    const retired = await assignTenantTier({ organizationId: fx.orgA.organizationId, tierId: retiredTierId, actor });
    expect(retired).toMatchObject({ ok: false });
    expect((retired as { error: string }).error).toContain("retired");

    const fallback = await resolveDefaultTier();
    const change = await assignTenantTier({ organizationId: fx.orgA.organizationId, tierId: fallback!.id, actor });
    expect(change).toMatchObject({ ok: true, created: false, fromTier: { id: activeTierId }, toTier: { id: fallback!.id } });
    expect(await rowOf(fx.orgA.organizationId)).toEqual({ tierId: fallback!.id, status: "active" });

    const audits = await db
      .select({ action: auditLogs.action, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, fx.orgA.organizationId));
    const tierAudits = audits.filter((a) => a.action === "tenant.tier_change");
    expect(tierAudits).toHaveLength(2);
    expect((tierAudits[0]!.metadata as { firstAssignment?: boolean }).firstAssignment).toBe(true);

    // B never had a row and still has none.
    expect(await rowOf(fx.orgB.organizationId)).toBeNull();
  });
});
