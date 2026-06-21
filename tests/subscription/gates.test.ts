/**
 * BL-16 — runtime tests for the subscription gate library.
 *
 * Exercises the live behavior of:
 *   - ensureFeature(orgId, key)             → throws FeatureGateError off-tier
 *   - enforceQuota(orgId, key, delta?)      → atomic counter UPSERT + throw
 *   - refundQuota(orgId, key, count?)       → atomic decrement with GREATEST(0)
 *   - getCurrentUsage(orgId, key)           → read-only peek
 *
 * These functions live on the money path — every AI request, every
 * proposal create, every feature gate. A regression here either
 * over-charges customers or silently lets them past the cap. The
 * tests below prove the documented invariants against a real
 * Postgres + a real subscription tier row, with no mocking.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { tenantUsageCounters } from "@/db/schema";
import {
  FeatureGateError,
  QuotaExceededError,
  ensureFeature,
  enforceQuota,
  getCurrentUsage,
  refundQuota,
} from "@/lib/subscription-gates";
import {
  createTierAndSubscribe,
  createTwoTenants,
  type TwoTenantFixture,
} from "../helpers/fixtures";

describe("BL-16 — subscription gates (runtime)", () => {
  let fx: TwoTenantFixture;

  beforeEach(async () => {
    fx = await createTwoTenants("subgates");
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  // ── ensureFeature ───────────────────────────────────────────────────

  describe("ensureFeature", () => {
    it("denies when the tenant has no subscription row", async () => {
      // orgA was never given a subscription, so getCurrentTier returns null.
      await expect(
        ensureFeature(fx.orgA.organizationId, "winnerAnalysis"),
      ).rejects.toBeInstanceOf(FeatureGateError);
    });

    it("denies when the tier flag is false", async () => {
      const tier = await createTierAndSubscribe({
        organizationId: fx.orgA.organizationId,
        slug: `bronze-${fx.orgA.organizationId.slice(0, 8)}`,
        name: "Bronze",
        featureFlags: { winnerAnalysis: false },
      });
      try {
        await expect(
          ensureFeature(fx.orgA.organizationId, "winnerAnalysis"),
        ).rejects.toBeInstanceOf(FeatureGateError);
      } finally {
        await tier.cleanup();
      }
    });

    it("allows when the tier flag is true", async () => {
      const tier = await createTierAndSubscribe({
        organizationId: fx.orgA.organizationId,
        slug: `gold-${fx.orgA.organizationId.slice(0, 8)}`,
        name: "Gold",
        featureFlags: { winnerAnalysis: true },
      });
      try {
        await expect(
          ensureFeature(fx.orgA.organizationId, "winnerAnalysis"),
        ).resolves.toBeUndefined();
      } finally {
        await tier.cleanup();
      }
    });

    it("honors a per-tenant override flipping a flag ON", async () => {
      const tier = await createTierAndSubscribe({
        organizationId: fx.orgA.organizationId,
        slug: `bronze-${fx.orgA.organizationId.slice(0, 8)}`,
        name: "Bronze",
        featureFlags: { winnerAnalysis: false },
        overrides: { featureFlags: { winnerAnalysis: true } },
      });
      try {
        await expect(
          ensureFeature(fx.orgA.organizationId, "winnerAnalysis"),
        ).resolves.toBeUndefined();
      } finally {
        await tier.cleanup();
      }
    });

    it("honors a per-tenant override flipping a flag OFF", async () => {
      const tier = await createTierAndSubscribe({
        organizationId: fx.orgA.organizationId,
        slug: `gold-${fx.orgA.organizationId.slice(0, 8)}`,
        name: "Gold",
        featureFlags: { winnerAnalysis: true },
        overrides: { featureFlags: { winnerAnalysis: false } },
      });
      try {
        await expect(
          ensureFeature(fx.orgA.organizationId, "winnerAnalysis"),
        ).rejects.toBeInstanceOf(FeatureGateError);
      } finally {
        await tier.cleanup();
      }
    });

    it("denies every feature on a retired (inactive) tier", async () => {
      const tier = await createTierAndSubscribe({
        organizationId: fx.orgA.organizationId,
        slug: `retired-${fx.orgA.organizationId.slice(0, 8)}`,
        name: "Retired Gold",
        featureFlags: { winnerAnalysis: true, aiAutoDraft: true },
        active: false,
      });
      try {
        await expect(
          ensureFeature(fx.orgA.organizationId, "winnerAnalysis"),
        ).rejects.toBeInstanceOf(FeatureGateError);
        await expect(
          ensureFeature(fx.orgA.organizationId, "aiAutoDraft"),
        ).rejects.toBeInstanceOf(FeatureGateError);
      } finally {
        await tier.cleanup();
      }
    });
  });

  // ── enforceQuota ────────────────────────────────────────────────────

  describe("enforceQuota", () => {
    it("denies when the tenant has no subscription row", async () => {
      await expect(
        enforceQuota(fx.orgA.organizationId, "aiRequestsPerMonth"),
      ).rejects.toBeInstanceOf(QuotaExceededError);
    });

    it("is a no-op when the quota is 0 (unlimited)", async () => {
      const tier = await createTierAndSubscribe({
        organizationId: fx.orgA.organizationId,
        slug: `unlimited-${fx.orgA.organizationId.slice(0, 8)}`,
        name: "Platinum",
        quotas: { aiRequestsPerMonth: 0 },
      });
      try {
        const r = await enforceQuota(
          fx.orgA.organizationId,
          "aiRequestsPerMonth",
        );
        expect(r).toEqual({ used: 0, limit: 0 });
        // No counter row should have been written for an unlimited quota.
        expect(
          await getCurrentUsage(
            fx.orgA.organizationId,
            "aiRequestsPerMonth",
          ),
        ).toBe(0);
      } finally {
        await tier.cleanup();
      }
    });

    it("increments the counter and returns used/limit", async () => {
      const tier = await createTierAndSubscribe({
        organizationId: fx.orgA.organizationId,
        slug: `silver-${fx.orgA.organizationId.slice(0, 8)}`,
        name: "Silver",
        quotas: { aiRequestsPerMonth: 5 },
      });
      try {
        const r1 = await enforceQuota(
          fx.orgA.organizationId,
          "aiRequestsPerMonth",
        );
        expect(r1).toEqual({ used: 1, limit: 5 });

        const r2 = await enforceQuota(
          fx.orgA.organizationId,
          "aiRequestsPerMonth",
        );
        expect(r2).toEqual({ used: 2, limit: 5 });

        expect(
          await getCurrentUsage(
            fx.orgA.organizationId,
            "aiRequestsPerMonth",
          ),
        ).toBe(2);
      } finally {
        await tier.cleanup();
      }
    });

    it("throws QuotaExceededError when the increment pushes over the limit", async () => {
      const tier = await createTierAndSubscribe({
        organizationId: fx.orgA.organizationId,
        slug: `bronze-${fx.orgA.organizationId.slice(0, 8)}`,
        name: "Bronze",
        quotas: { aiRequestsPerMonth: 2 },
      });
      try {
        await enforceQuota(
          fx.orgA.organizationId,
          "aiRequestsPerMonth",
        );
        await enforceQuota(
          fx.orgA.organizationId,
          "aiRequestsPerMonth",
        );
        // The third call should overshoot. The counter still
        // increments (documented behaviour — over-quota usage is
        // recorded for admin visibility) and the error carries the
        // used/limit values.
        await expect(
          enforceQuota(fx.orgA.organizationId, "aiRequestsPerMonth"),
        ).rejects.toMatchObject({
          name: "QuotaExceededError",
          quotaKey: "aiRequestsPerMonth",
          limit: 2,
          used: 3,
          tierName: "Bronze",
        });
        expect(
          await getCurrentUsage(
            fx.orgA.organizationId,
            "aiRequestsPerMonth",
          ),
        ).toBe(3);
      } finally {
        await tier.cleanup();
      }
    });

    it("returns silently when delta <= 0 (no-op)", async () => {
      const tier = await createTierAndSubscribe({
        organizationId: fx.orgA.organizationId,
        slug: `silver-${fx.orgA.organizationId.slice(0, 8)}`,
        name: "Silver",
        quotas: { aiRequestsPerMonth: 1 },
      });
      try {
        const r = await enforceQuota(
          fx.orgA.organizationId,
          "aiRequestsPerMonth",
          0,
        );
        expect(r).toEqual({ used: 0, limit: 0 });
        expect(
          await getCurrentUsage(
            fx.orgA.organizationId,
            "aiRequestsPerMonth",
          ),
        ).toBe(0);
      } finally {
        await tier.cleanup();
      }
    });

    it("counts per tenant — orgA usage doesn't bleed into orgB", async () => {
      const tA = await createTierAndSubscribe({
        organizationId: fx.orgA.organizationId,
        slug: `silver-a-${fx.orgA.organizationId.slice(0, 8)}`,
        name: "Silver",
        quotas: { aiRequestsPerMonth: 10 },
      });
      const tB = await createTierAndSubscribe({
        organizationId: fx.orgB.organizationId,
        slug: `silver-b-${fx.orgB.organizationId.slice(0, 8)}`,
        name: "Silver",
        quotas: { aiRequestsPerMonth: 10 },
      });
      try {
        await enforceQuota(fx.orgA.organizationId, "aiRequestsPerMonth");
        await enforceQuota(fx.orgA.organizationId, "aiRequestsPerMonth");
        await enforceQuota(fx.orgA.organizationId, "aiRequestsPerMonth");
        await enforceQuota(fx.orgB.organizationId, "aiRequestsPerMonth");

        expect(
          await getCurrentUsage(
            fx.orgA.organizationId,
            "aiRequestsPerMonth",
          ),
        ).toBe(3);
        expect(
          await getCurrentUsage(
            fx.orgB.organizationId,
            "aiRequestsPerMonth",
          ),
        ).toBe(1);
      } finally {
        await tA.cleanup();
        await tB.cleanup();
      }
    });
  });

  // ── refundQuota ─────────────────────────────────────────────────────

  describe("refundQuota", () => {
    it("decrements the counter", async () => {
      const tier = await createTierAndSubscribe({
        organizationId: fx.orgA.organizationId,
        slug: `silver-${fx.orgA.organizationId.slice(0, 8)}`,
        name: "Silver",
        quotas: { aiRequestsPerMonth: 10 },
      });
      try {
        await enforceQuota(fx.orgA.organizationId, "aiRequestsPerMonth");
        await enforceQuota(fx.orgA.organizationId, "aiRequestsPerMonth");
        expect(
          await getCurrentUsage(
            fx.orgA.organizationId,
            "aiRequestsPerMonth",
          ),
        ).toBe(2);

        await refundQuota(fx.orgA.organizationId, "aiRequestsPerMonth");
        expect(
          await getCurrentUsage(
            fx.orgA.organizationId,
            "aiRequestsPerMonth",
          ),
        ).toBe(1);
      } finally {
        await tier.cleanup();
      }
    });

    it("clamps at zero (never produces a negative counter)", async () => {
      const tier = await createTierAndSubscribe({
        organizationId: fx.orgA.organizationId,
        slug: `silver-${fx.orgA.organizationId.slice(0, 8)}`,
        name: "Silver",
        quotas: { aiRequestsPerMonth: 10 },
      });
      try {
        // Charge once, refund three times. The counter should land at 0.
        await enforceQuota(fx.orgA.organizationId, "aiRequestsPerMonth");
        await refundQuota(fx.orgA.organizationId, "aiRequestsPerMonth");
        await refundQuota(fx.orgA.organizationId, "aiRequestsPerMonth");
        await refundQuota(fx.orgA.organizationId, "aiRequestsPerMonth");
        expect(
          await getCurrentUsage(
            fx.orgA.organizationId,
            "aiRequestsPerMonth",
          ),
        ).toBe(0);
      } finally {
        await tier.cleanup();
      }
    });

    it("is a no-op when the quota is 0 (unlimited tier)", async () => {
      const tier = await createTierAndSubscribe({
        organizationId: fx.orgA.organizationId,
        slug: `unlimited-${fx.orgA.organizationId.slice(0, 8)}`,
        name: "Platinum",
        quotas: { aiRequestsPerMonth: 0 },
      });
      try {
        // Pre-seed a counter row to prove refund leaves it alone.
        await db.insert(tenantUsageCounters).values({
          organizationId: fx.orgA.organizationId,
          key: "aiRequestsPerMonth",
          periodStart: firstOfMonthUtc(),
          periodEnd: firstOfNextMonthUtc(),
          value: 5,
        });
        await refundQuota(fx.orgA.organizationId, "aiRequestsPerMonth");
        // Refund is a no-op on unlimited tiers (no point decrementing
        // a counter that isn't being read).
        const [row] = await db
          .select({ value: tenantUsageCounters.value })
          .from(tenantUsageCounters)
          .where(
            and(
              eq(
                tenantUsageCounters.organizationId,
                fx.orgA.organizationId,
              ),
              eq(tenantUsageCounters.key, "aiRequestsPerMonth"),
            ),
          )
          .limit(1);
        expect(row?.value).toBe(5);
      } finally {
        await tier.cleanup();
      }
    });

    it("is a no-op when the tenant has no subscription row", async () => {
      await expect(
        refundQuota(fx.orgA.organizationId, "aiRequestsPerMonth"),
      ).resolves.toBeUndefined();
    });

    it("multi-step: enforce → over-quota throw → refund → enforce works again", async () => {
      const tier = await createTierAndSubscribe({
        organizationId: fx.orgA.organizationId,
        slug: `bronze-${fx.orgA.organizationId.slice(0, 8)}`,
        name: "Bronze",
        quotas: { aiRequestsPerMonth: 2 },
      });
      try {
        await enforceQuota(fx.orgA.organizationId, "aiRequestsPerMonth");
        await enforceQuota(fx.orgA.organizationId, "aiRequestsPerMonth");
        // Third call throws but still increments the counter.
        await expect(
          enforceQuota(fx.orgA.organizationId, "aiRequestsPerMonth"),
        ).rejects.toBeInstanceOf(QuotaExceededError);
        expect(
          await getCurrentUsage(
            fx.orgA.organizationId,
            "aiRequestsPerMonth",
          ),
        ).toBe(3);

        // Refund the over-charge so the tenant returns to limit + 0.
        await refundQuota(fx.orgA.organizationId, "aiRequestsPerMonth");
        expect(
          await getCurrentUsage(
            fx.orgA.organizationId,
            "aiRequestsPerMonth",
          ),
        ).toBe(2);

        // Next call is still over because they used 2/2. Refund again.
        await refundQuota(fx.orgA.organizationId, "aiRequestsPerMonth");
        const r = await enforceQuota(
          fx.orgA.organizationId,
          "aiRequestsPerMonth",
        );
        expect(r).toEqual({ used: 2, limit: 2 });
      } finally {
        await tier.cleanup();
      }
    });
  });
});

function firstOfMonthUtc(): Date {
  const n = new Date();
  return new Date(
    Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1, 0, 0, 0, 0),
  );
}
function firstOfNextMonthUtc(): Date {
  const n = new Date();
  return new Date(
    Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );
}
