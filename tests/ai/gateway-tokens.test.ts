/**
 * BL-PACKAGES Slice 1 — runtime tests for `completeForTenant` token cap.
 *
 * The gateway protects gross margin. A regression here either:
 *   - lets a runaway tenant burn unlimited tokens (lost revenue), or
 *   - refuses legitimate tenants that haven't hit their cap (broken UX).
 *
 * Tests cover the documented contract:
 *   - Pre-check refuses when usage ≥ cap (no provider call made)
 *   - Pre-check allows when usage < cap
 *   - Unlimited tier (cap = 0) skips the check entirely
 *   - Post-record adds inputTokens + outputTokens to the counter
 *   - Provider failure → counter NOT incremented (no charge for failures)
 *
 * Approach:
 *   - Mock the AI provider so we control returned token counts +
 *     can simulate failures.
 *   - Leave the DB, `enforceQuota`, `getCurrentUsage`, and tier
 *     resolution UN-mocked so the real counter behaviour is exercised.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { db } from "@/db";
import {
  subscriptionTiers,
  tenantSubscriptions,
  type TierFeatureFlags,
  type TierQuotas,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  createTwoTenants,
  type TwoTenantFixture,
} from "../helpers/fixtures";
import {
  QuotaExceededError,
  getCurrentUsage,
} from "@/lib/subscription-gates";

/**
 * Local tier + subscription helper. Inlined here (rather than added to
 * `tests/helpers/fixtures.ts`) so this PR has no merge-time coupling
 * with sibling test PRs that also need a tier fixture. Once both ship,
 * the shared helper can be promoted into `fixtures.ts` in a tidy-up PR.
 */
async function createTierAndSubscribe(opts: {
  organizationId: string;
  slug: string;
  name: string;
  quotas?: Partial<TierQuotas>;
  featureFlags?: Partial<TierFeatureFlags>;
}): Promise<{ tierId: string; cleanup: () => Promise<void> }> {
  const defaultFlags: TierFeatureFlags = {
    aiAutoDraft: false,
    winnerAnalysis: false,
    complianceMatrix: false,
    bulkExport: false,
    apiAccess: false,
    customTemplates: false,
  };
  const defaultQuotas: TierQuotas = {
    aiRequestsPerMonth: 0,
    aiTokensPerMonth: 0,
    proposalsPerMonth: 0,
    seatsIncluded: 0,
    storageGb: 0,
  };
  const [tier] = await db
    .insert(subscriptionTiers)
    .values({
      slug: opts.slug,
      name: opts.name,
      featureFlags: { ...defaultFlags, ...(opts.featureFlags ?? {}) },
      quotas: { ...defaultQuotas, ...(opts.quotas ?? {}) },
      active: true,
    })
    .returning({ id: subscriptionTiers.id });
  if (!tier) throw new Error("createTierAndSubscribe: insert failed");
  await db
    .insert(tenantSubscriptions)
    .values({
      organizationId: opts.organizationId,
      tierId: tier.id,
      status: "active",
    })
    .onConflictDoUpdate({
      target: tenantSubscriptions.organizationId,
      set: { tierId: tier.id, status: "active" },
    });
  return {
    tierId: tier.id,
    async cleanup() {
      await db
        .delete(tenantSubscriptions)
        .where(
          eq(tenantSubscriptions.organizationId, opts.organizationId),
        );
      await db.delete(subscriptionTiers).where(eq(subscriptionTiers.id, tier.id));
    },
  };
}

// ── AI provider mock ───────────────────────────────────────────────────
//
// vi.mock("@/lib/ai") can't intercept the in-module call to `complete`
// from `completeForTenant` (ESM closure binding, not export lookup).
// Production exposes a test seam `__setCompleteImplForTest` that swaps
// the function `completeForTenant` calls internally.

import {
  completeForTenant,
  __setCompleteImplForTest,
} from "@/lib/ai";

// Configured per test: what tokens to return + whether to throw.
let nextProviderResult: {
  text: string;
  inputTokens: number;
  outputTokens: number;
} = { text: "ok", inputTokens: 10, outputTokens: 20 };
let providerCallCount = 0;
let providerShouldThrow: Error | null = null;

describe("BL-PACKAGES — completeForTenant token cap (runtime)", () => {
  let fx: TwoTenantFixture;
  let cleanupTier: () => Promise<void> = async () => {};

  beforeEach(async () => {
    fx = await createTwoTenants("ai-gateway");
    providerCallCount = 0;
    providerShouldThrow = null;
    nextProviderResult = { text: "ok", inputTokens: 10, outputTokens: 20 };
    __setCompleteImplForTest(async () => {
      providerCallCount += 1;
      if (providerShouldThrow) throw providerShouldThrow;
      return {
        text: nextProviderResult.text,
        provider: "stub" as const,
        model: "test-mock",
        inputTokens: nextProviderResult.inputTokens,
        outputTokens: nextProviderResult.outputTokens,
        stubbed: false,
      };
    });
  });

  afterEach(async () => {
    __setCompleteImplForTest(null);
    await cleanupTier();
    await fx.cleanup();
  });

  // ── Pre-check (over-quota refusal) ──────────────────────────────────

  it("refuses with QuotaExceededError when used >= cap (no provider call)", async () => {
    const tier = await createTierAndSubscribe({
      organizationId: fx.orgA.organizationId,
      slug: `ai-tight-${fx.orgA.organizationId.slice(0, 8)}`,
      name: "Tight",
      quotas: { aiTokensPerMonth: 100 },
    });
    cleanupTier = tier.cleanup;

    // Push usage to exactly the cap.
    nextProviderResult = { text: "seed", inputTokens: 50, outputTokens: 50 };
    await completeForTenant({
      organizationId: fx.orgA.organizationId,
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });
    expect(
      await getCurrentUsage(
        fx.orgA.organizationId,
        "aiTokensPerMonth",
      ),
    ).toBe(100);

    // The next call must refuse before the provider fires.
    const callsBefore = providerCallCount;
    await expect(
      completeForTenant({
        organizationId: fx.orgA.organizationId,
        system: "x",
        messages: [{ role: "user", content: "y" }],
      }),
    ).rejects.toBeInstanceOf(QuotaExceededError);
    expect(providerCallCount).toBe(callsBefore);
  });

  // ── Pre-check (allow when under cap) ────────────────────────────────

  it("allows when used < cap and records the call's tokens", async () => {
    const tier = await createTierAndSubscribe({
      organizationId: fx.orgA.organizationId,
      slug: `ai-allow-${fx.orgA.organizationId.slice(0, 8)}`,
      name: "Allow",
      quotas: { aiTokensPerMonth: 1000 },
    });
    cleanupTier = tier.cleanup;

    nextProviderResult = { text: "ok", inputTokens: 30, outputTokens: 70 };
    const result = await completeForTenant({
      organizationId: fx.orgA.organizationId,
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });
    expect(result.text).toBe("ok");
    expect(
      await getCurrentUsage(
        fx.orgA.organizationId,
        "aiTokensPerMonth",
      ),
    ).toBe(100); // 30 + 70
  });

  // ── Unlimited tier (cap = 0) ────────────────────────────────────────

  it("never blocks an unlimited tier (cap = 0) and skips counter write", async () => {
    const tier = await createTierAndSubscribe({
      organizationId: fx.orgA.organizationId,
      slug: `ai-unlim-${fx.orgA.organizationId.slice(0, 8)}`,
      name: "Unlimited",
      quotas: { aiTokensPerMonth: 0 },
    });
    cleanupTier = tier.cleanup;

    nextProviderResult = {
      text: "ok",
      inputTokens: 100_000,
      outputTokens: 100_000,
    };
    const result = await completeForTenant({
      organizationId: fx.orgA.organizationId,
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });
    expect(result.text).toBe("ok");
    // On unlimited tiers, enforceQuota is a no-op (no counter row written).
    expect(
      await getCurrentUsage(
        fx.orgA.organizationId,
        "aiTokensPerMonth",
      ),
    ).toBe(0);
  });

  // ── Post-record on provider failure (no charge for failures) ────────

  it("does NOT increment the counter when the provider call throws", async () => {
    const tier = await createTierAndSubscribe({
      organizationId: fx.orgA.organizationId,
      slug: `ai-fail-${fx.orgA.organizationId.slice(0, 8)}`,
      name: "Standard",
      quotas: { aiTokensPerMonth: 1000 },
    });
    cleanupTier = tier.cleanup;

    providerShouldThrow = new Error("simulated provider 503");
    await expect(
      completeForTenant({
        organizationId: fx.orgA.organizationId,
        system: "x",
        messages: [{ role: "user", content: "y" }],
      }),
    ).rejects.toThrow("simulated provider 503");
    expect(
      await getCurrentUsage(
        fx.orgA.organizationId,
        "aiTokensPerMonth",
      ),
    ).toBe(0);
  });

  // ── Multi-call: counter accumulates per tenant, isolated across tenants ─

  it("counter accumulates per tenant and is isolated across tenants", async () => {
    const tA = await createTierAndSubscribe({
      organizationId: fx.orgA.organizationId,
      slug: `ai-acc-a-${fx.orgA.organizationId.slice(0, 8)}`,
      name: "Standard",
      quotas: { aiTokensPerMonth: 10_000 },
    });
    const tB = await createTierAndSubscribe({
      organizationId: fx.orgB.organizationId,
      slug: `ai-acc-b-${fx.orgB.organizationId.slice(0, 8)}`,
      name: "Standard",
      quotas: { aiTokensPerMonth: 10_000 },
    });
    cleanupTier = async () => {
      await tA.cleanup();
      await tB.cleanup();
    };

    nextProviderResult = { text: "ok", inputTokens: 100, outputTokens: 200 };
    await completeForTenant({
      organizationId: fx.orgA.organizationId,
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });
    await completeForTenant({
      organizationId: fx.orgA.organizationId,
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });
    await completeForTenant({
      organizationId: fx.orgB.organizationId,
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });

    expect(
      await getCurrentUsage(
        fx.orgA.organizationId,
        "aiTokensPerMonth",
      ),
    ).toBe(600); // 2 * 300
    expect(
      await getCurrentUsage(
        fx.orgB.organizationId,
        "aiTokensPerMonth",
      ),
    ).toBe(300);
  });

  // ── Post-record over-the-cap path ───────────────────────────────────

  it("post-record over-the-cap: call succeeds + counter records the overage", async () => {
    const tier = await createTierAndSubscribe({
      organizationId: fx.orgA.organizationId,
      slug: `ai-over-${fx.orgA.organizationId.slice(0, 8)}`,
      name: "Tight",
      quotas: { aiTokensPerMonth: 50 },
    });
    cleanupTier = tier.cleanup;

    // The call's tokens (1000) far exceed the cap. The pre-check sees
    // 0 < 50 and allows; the post-record exceeds 50. Documented
    // behaviour: don't fail the user (they already got the answer),
    // but advance the counter so the next call's pre-check refuses.
    nextProviderResult = { text: "ok", inputTokens: 500, outputTokens: 500 };
    const result = await completeForTenant({
      organizationId: fx.orgA.organizationId,
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });
    expect(result.text).toBe("ok");
    expect(
      await getCurrentUsage(
        fx.orgA.organizationId,
        "aiTokensPerMonth",
      ),
    ).toBe(1000);

    // Next call is refused at pre-check.
    await expect(
      completeForTenant({
        organizationId: fx.orgA.organizationId,
        system: "x",
        messages: [{ role: "user", content: "y" }],
      }),
    ).rejects.toBeInstanceOf(QuotaExceededError);
  });

  // ── No tier at all (cannot mint requests for an unprovisioned tenant) ─

  it("tenants without any subscription are still allowed through (tier-less path is the default-allow shape)", async () => {
    // Documented behaviour for completeForTenant: when there is no
    // tier row, getCurrentTier returns null and the pre-check is
    // skipped entirely. Post-record's enforceQuota will swallow its
    // QuotaExceededError because no tier means no counter is written.
    // The caller-facing contract: "no tier == no token cap enforcement
    // at the gateway layer" (other gates like ensureFeature still
    // refuse based on missing tier).
    const result = await completeForTenant({
      organizationId: fx.orgA.organizationId,
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });
    expect(result.text).toBe("ok");
  });
});
