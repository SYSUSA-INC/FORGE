/**
 * BL-PACKAGES add-ons Slice 1 — against Postgres: a grant raises the
 * owning tenant's cap and unlocks its feature and nobody else's, an
 * ended or expired grant stops counting, Stripe provisioning is
 * idempotent and cancellation by subscription id ends the right grant,
 * and every write is audited in the tenant's own log.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, tenantAddons, tierAddons } from "@/db/schema";
import {
  activeAddonEffects,
  grantTenantAddon,
  listTenantAddons,
  provisionStripeAddon,
  revokeTenantAddon,
  syncStripeAddonSubscription,
} from "@/lib/addons";
import { enforceSeatsQuota, ensureFeature, getCurrentTier } from "@/lib/subscription-gates";
import { createTierAndSubscribe, createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

describe("BL-PACKAGES add-ons — grants on top of the tier", () => {
  let fx: TwoTenantFixture;
  let tierA: { cleanup: () => Promise<void> };
  let tierB: { cleanup: () => Promise<void> };
  let tokensAddon = "";
  let featureAddon = "";
  const tag = Date.now().toString(36);

  beforeEach(async () => {
    fx = await createTwoTenants("addons");
    tierA = await createTierAndSubscribe({
      organizationId: fx.orgA.organizationId,
      slug: `ad-a-${tag}`,
      name: "Add-ons A",
      featureFlags: { aiAutoDraft: true },
      quotas: { aiTokensPerMonth: 1_000_000, aiRequestsPerMonth: 0 },
    });
    tierB = await createTierAndSubscribe({
      organizationId: fx.orgB.organizationId,
      slug: `ad-b-${tag}`,
      name: "Add-ons B",
      quotas: { aiTokensPerMonth: 1_000_000 },
    });
    const [tok] = await db
      .insert(tierAddons)
      .values({ slug: `tok-${tag}`, name: "500K tokens", kind: "ai_tokens", aiTokensPerMonth: 500_000, priceMonthlyCents: 4900, stripePriceId: `price_tok_${tag}` })
      .returning({ id: tierAddons.id });
    const [feat] = await db
      .insert(tierAddons)
      .values({ slug: `win-${tag}`, name: "Winner analysis", kind: "feature", featureFlag: "winnerAnalysis", priceMonthlyCents: 9900 })
      .returning({ id: tierAddons.id });
    tokensAddon = tok!.id;
    featureAddon = feat!.id;
  });

  afterEach(async () => {
    await tierA.cleanup();
    await tierB.cleanup();
    await fx.cleanup(); // cascades tenant_addon
    await db.delete(tierAddons).where(inArray(tierAddons.id, [tokensAddon, featureAddon]));
  });

  it("raises the owning tenant's cap and unlocks its feature, nobody else's; ending and expiry stop it", async () => {
    const actor = { userId: fx.orgA.userId, email: "admin@test" };
    expect((await getCurrentTier(fx.orgA.organizationId))!.platformQuotas.aiTokensPerMonth).toBe(1_000_000);
    await expect(ensureFeature(fx.orgA.organizationId, "winnerAnalysis")).rejects.toThrow();

    const g1 = await grantTenantAddon({ organizationId: fx.orgA.organizationId, addonId: tokensAddon, quantity: 2, note: "pilot", actor });
    const g2 = await grantTenantAddon({ organizationId: fx.orgA.organizationId, addonId: featureAddon, quantity: 1, actor });
    expect(g1.ok && g2.ok).toBe(true);
    expect(await grantTenantAddon({ organizationId: fx.orgA.organizationId, addonId: tokensAddon, quantity: 0, actor })).toEqual({ ok: false, error: "Quantity: a whole number from 1 to 100." });

    const a = (await getCurrentTier(fx.orgA.organizationId))!;
    expect(a.platformQuotas.aiTokensPerMonth).toBe(2_000_000);
    expect(a.effectiveQuotas.aiTokensPerMonth).toBe(2_000_000);
    expect(a.effectiveFlags.winnerAnalysis).toBe(true);
    expect(a.addons).toEqual({ count: 2, extraTokens: 1_000_000, extraSeats: 0, extraStorageGb: 0, unlockedFlags: ["winnerAnalysis"] });
    await expect(ensureFeature(fx.orgA.organizationId, "winnerAnalysis")).resolves.toBeUndefined();

    // B is untouched.
    const b = (await getCurrentTier(fx.orgB.organizationId))!;
    expect(b.platformQuotas.aiTokensPerMonth).toBe(1_000_000);
    expect(b.effectiveFlags.winnerAnalysis).toBe(false);
    expect(b.addons.count).toBe(0);
    expect(await listTenantAddons({ organizationId: fx.orgB.organizationId })).toEqual([]);

    // B cannot end A's grant; A can.
    if (!g2.ok) return;
    expect(await revokeTenantAddon({ organizationId: fx.orgB.organizationId, tenantAddonId: g2.id, actor })).toEqual({ ok: false, error: "Grant not found." });
    expect(await revokeTenantAddon({ organizationId: fx.orgA.organizationId, tenantAddonId: g2.id, actor })).toEqual({ ok: true, source: "manual" });
    expect(await revokeTenantAddon({ organizationId: fx.orgA.organizationId, tenantAddonId: g2.id, actor })).toEqual({ ok: false, error: "This grant has already ended." });
    await expect(ensureFeature(fx.orgA.organizationId, "winnerAnalysis")).rejects.toThrow();

    // An expired grant stops counting without being cancelled; a retired catalogue entry too.
    if (!g1.ok) return;
    await db.update(tenantAddons).set({ endsAt: new Date(Date.now() - 1000) }).where(eq(tenantAddons.id, g1.id));
    expect(await activeAddonEffects({ organizationId: fx.orgA.organizationId })).toEqual([]);
    const rows = await listTenantAddons({ organizationId: fx.orgA.organizationId });
    expect(rows.map((r) => [r.slug, r.status, r.live]).sort()).toEqual([
      [`tok-${tag}`, "active", false],
      [`win-${tag}`, "canceled", false],
    ]);
    await db.update(tenantAddons).set({ endsAt: null }).where(eq(tenantAddons.id, g1.id));
    expect((await getCurrentTier(fx.orgA.organizationId))!.platformQuotas.aiTokensPerMonth).toBe(2_000_000);
    await db.update(tierAddons).set({ active: false }).where(eq(tierAddons.id, tokensAddon));
    expect((await getCurrentTier(fx.orgA.organizationId))!.platformQuotas.aiTokensPerMonth).toBe(1_000_000);

    const audits = await db.select({ action: auditLogs.action, organizationId: auditLogs.organizationId }).from(auditLogs).where(inArray(auditLogs.organizationId, [fx.orgA.organizationId, fx.orgB.organizationId]));
    expect(audits.filter((x) => x.action === "tenant.addon.grant")).toHaveLength(2);
    expect(audits.filter((x) => x.action === "tenant.addon.revoke")).toHaveLength(1);
    expect(audits.every((x) => x.organizationId === fx.orgA.organizationId)).toBe(true);
  });

  it("records a Stripe purchase once per subscription and ends it by subscription id", async () => {
    const subId = `sub_${tag}_a`;
    const first = await provisionStripeAddon({ organizationId: fx.orgA.organizationId, addonSlug: `tok-${tag}`, quantity: 3, stripeSubscriptionId: subId });
    expect(first).toMatchObject({ ok: true, created: true });
    const again = await provisionStripeAddon({ organizationId: fx.orgA.organizationId, addonSlug: `tok-${tag}`, quantity: 4, stripeSubscriptionId: subId });
    expect(again).toMatchObject({ ok: true, created: false });
    expect(await provisionStripeAddon({ organizationId: fx.orgA.organizationId, addonSlug: "nope", quantity: 1, stripeSubscriptionId: "sub_x" })).toEqual({ ok: false, error: 'Unknown add-on "nope".' });
    const a = (await getCurrentTier(fx.orgA.organizationId))!;
    expect(a.platformQuotas.aiTokensPerMonth).toBe(3_000_000); // 4 × 500K after the replay updated the quantity
    expect((await listTenantAddons({ organizationId: fx.orgA.organizationId })).map((r) => [r.source, r.quantity, r.live])).toEqual([["stripe", 4, true]]);

    // An unknown subscription is not ours (the webhook then treats it as the plan).
    expect(await syncStripeAddonSubscription({ stripeSubscriptionId: "sub_unknown", stripeStatus: "canceled" })).toEqual({ matched: false, organizationId: null, status: null });

    // Cancelled with a paid period left: serves until then, then ends.
    const periodEnd = new Date(Date.now() + 86_400_000);
    expect(await syncStripeAddonSubscription({ stripeSubscriptionId: subId, stripeStatus: "canceled", currentPeriodEnd: periodEnd })).toEqual({ matched: true, organizationId: fx.orgA.organizationId, status: "canceled" });
    const [row] = await listTenantAddons({ organizationId: fx.orgA.organizationId });
    expect(row!.status).toBe("canceled");
    expect(row!.endsAt).toBe(periodEnd.toISOString());
    expect(row!.live).toBe(false); // status canceled never counts, even inside the paid period
    expect((await getCurrentTier(fx.orgA.organizationId))!.platformQuotas.aiTokensPerMonth).toBe(1_000_000);

    // B saw nothing.
    expect((await getCurrentTier(fx.orgB.organizationId))!.addons.count).toBe(0);
    const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.organizationId, fx.orgA.organizationId));
    expect(audits.filter((x) => x.action === "tenant.addon.purchased")).toHaveLength(1);
    expect(audits.filter((x) => x.action === "tenant.addon.cancelled")).toHaveLength(1);
  });
  it("Slice 2b — a seats add-on raises only its tenant's seat limit, and stops with the grant", async () => {
    const actor = { userId: fx.orgA.userId, email: "admin@test" };
    const seatsTier = await createTierAndSubscribe({
      organizationId: fx.orgA.organizationId,
      slug: `ad-seats-${tag}`,
      name: "Seats",
      quotas: { seatsIncluded: 1 },
    });
    const [seats] = await db
      .insert(tierAddons)
      .values({ slug: `seats-${tag}`, name: "5 seats", kind: "seats", amountPerUnit: 5, priceMonthlyCents: 5000 })
      .returning({ id: tierAddons.id });
    try {
      // The fixture's one member already fills the single seat.
      await expect(enforceSeatsQuota(fx.orgA.organizationId)).rejects.toThrow();
      const granted = await grantTenantAddon({ organizationId: fx.orgA.organizationId, addonId: seats!.id, quantity: 2, actor });
      if (!granted.ok) throw new Error(granted.error);
      const tier = await getCurrentTier(fx.orgA.organizationId);
      expect(tier!.effectiveQuotas.seatsIncluded).toBe(11);
      expect(tier!.addons).toMatchObject({ extraSeats: 10, extraStorageGb: 0 });
      await expect(enforceSeatsQuota(fx.orgA.organizationId)).resolves.toEqual({ used: 1, limit: 11 });
      expect((await getCurrentTier(fx.orgB.organizationId))!.addons.extraSeats).toBe(0);

      expect(await revokeTenantAddon({ organizationId: fx.orgA.organizationId, tenantAddonId: granted.id, actor })).toMatchObject({ ok: true });
      await expect(enforceSeatsQuota(fx.orgA.organizationId)).rejects.toThrow();
    } finally {
      await db.delete(tenantAddons).where(eq(tenantAddons.addonId, seats!.id));
      await db.delete(tierAddons).where(eq(tierAddons.id, seats!.id));
      await seatsTier.cleanup();
    }
  });
});
