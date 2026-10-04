/**
 * BL-PACKAGES add-ons Slice 2c — Reports against Postgres: the plan gate
 * (tier flag, override, feature add-on) and the data read stays inside
 * the workspace.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { opportunities, tenantAddons, tenantSubscriptions, tierAddons } from "@/db/schema";
import { grantTenantAddon } from "@/lib/addons";
import { loadReportOpportunities, REPORTS_REFUSAL, reportsRefusal } from "@/lib/reports";
import { createTierAndSubscribe, createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

describe("BL-PACKAGES — Reports behind advancedReporting", () => {
  let fx: TwoTenantFixture;
  let tiers: { cleanup: () => Promise<void> }[] = [];
  const tag = Date.now().toString(36);

  beforeEach(async () => {
    fx = await createTwoTenants("reports");
    tiers = [
      await createTierAndSubscribe({ organizationId: fx.orgA.organizationId, slug: `rep-a-${tag}`, name: "Rep A", featureFlags: { advancedReporting: true } }),
      await createTierAndSubscribe({ organizationId: fx.orgB.organizationId, slug: `rep-b-${tag}`, name: "Rep B" }),
    ];
  });

  afterEach(async () => {
    for (const t of tiers) await t.cleanup();
    await fx.cleanup();
  });

  it("opens for the flag, an override or a feature add-on, and reads only the workspace's opportunities", async () => {
    expect(await reportsRefusal(fx.orgA.organizationId)).toBeNull();
    expect(await reportsRefusal(fx.orgB.organizationId)).toBe(REPORTS_REFUSAL);

    await db.update(opportunities).set({ stage: "won", agency: "GSA" }).where(eq(opportunities.id, fx.orgA.opportunityId));
    const rows = await loadReportOpportunities(fx.orgA.organizationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ stage: "won", agency: "GSA" });

    // An override opens it for B…
    await db.update(tenantSubscriptions).set({ customOverrides: { featureFlags: { advancedReporting: true } } }).where(eq(tenantSubscriptions.organizationId, fx.orgB.organizationId));
    expect(await reportsRefusal(fx.orgB.organizationId)).toBeNull();
    await db.update(tenantSubscriptions).set({ customOverrides: {} }).where(eq(tenantSubscriptions.organizationId, fx.orgB.organizationId));

    // …and so does a feature add-on.
    const [unlock] = await db
      .insert(tierAddons)
      .values({ slug: `rep-${tag}`, name: "Reports", kind: "feature", featureFlag: "advancedReporting" })
      .returning({ id: tierAddons.id });
    try {
      const g = await grantTenantAddon({ organizationId: fx.orgB.organizationId, addonId: unlock!.id, quantity: 1, actor: { userId: fx.orgB.userId, email: "b@test" } });
      expect(g.ok).toBe(true);
      expect(await reportsRefusal(fx.orgB.organizationId)).toBeNull();
      expect((await loadReportOpportunities(fx.orgB.organizationId)).map((r) => r.agency)).not.toContain("GSA");
    } finally {
      await db.delete(tenantAddons).where(eq(tenantAddons.addonId, unlock!.id));
      await db.delete(tierAddons).where(eq(tierAddons.id, unlock!.id));
    }
  });
});
