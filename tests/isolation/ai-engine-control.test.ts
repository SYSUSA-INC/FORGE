/**
 * BL-AIP-7c — the AI Engine control panel against Postgres. Two
 * tenants, each with a tier. Asserts: a feature routing override lands on
 * the deciding tenant's subscription only and a platform-pinned model is
 * refused; a budget can only lower the tier cap and getCurrentTier
 * applies it; month-to-date usage comes from the tenant's own ledger rows.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { aiCallLogs } from "@/db/schema";
import {
  getAiControlState,
  getTenantAiUsage,
  setAiBudget,
  setAiFeatureRouting,
} from "@/lib/ai-engine-control";
import { getCurrentTier } from "@/lib/subscription-gates";
import { createTierAndSubscribe, createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

describe("BL-AIP-7c — AI Engine control", () => {
  let fx: TwoTenantFixture;
  let tierA: { cleanup: () => Promise<void> };
  let tierB: { cleanup: () => Promise<void> };
  const tag = Date.now().toString(36);

  beforeEach(async () => {
    fx = await createTwoTenants("ai-control");
    tierA = await createTierAndSubscribe({
      organizationId: fx.orgA.organizationId,
      slug: `ctl-a-${tag}`,
      name: "Control A",
      featureFlags: { aiAutoDraft: true },
      quotas: { aiTokensPerMonth: 1_000_000, aiRequestsPerMonth: 100 },
      overrides: { aiModels: { proposal_scan: "claude-opus-5" } },
    });
    tierB = await createTierAndSubscribe({
      organizationId: fx.orgB.organizationId,
      slug: `ctl-b-${tag}`,
      name: "Control B",
      quotas: { aiTokensPerMonth: 0, aiRequestsPerMonth: 0 },
    });
  });

  afterEach(async () => {
    await tierA.cleanup();
    await tierB.cleanup();
    await fx.cleanup();
  });

  it("routes a feature per tenant and refuses a platform-pinned model", async () => {
    const actor = { userId: fx.orgA.userId, email: "a@test" };
    expect(
      await setAiFeatureRouting({ organizationId: fx.orgA.organizationId, feature: "section_draft", value: "fast", actor }),
    ).toEqual({ ok: true });
    expect(
      await setAiFeatureRouting({ organizationId: fx.orgA.organizationId, feature: "nope", value: "fast", actor }),
    ).toEqual({ ok: false, error: "Unknown AI feature." });
    const pinned = await setAiFeatureRouting({
      organizationId: fx.orgA.organizationId,
      feature: "proposal_scan",
      value: "standard",
      actor,
    });
    expect(pinned.ok).toBe(false);

    const a = await getCurrentTier(fx.orgA.organizationId);
    expect(a?.overrides.aiModels).toEqual({ proposal_scan: "claude-opus-5", section_draft: "fast" });
    const b = await getCurrentTier(fx.orgB.organizationId);
    expect(b?.overrides.aiModels ?? {}).toEqual({});

    // Back to the tier default removes the key.
    await setAiFeatureRouting({ organizationId: fx.orgA.organizationId, feature: "section_draft", value: "default", actor });
    expect((await getCurrentTier(fx.orgA.organizationId))?.overrides.aiModels).toEqual({ proposal_scan: "claude-opus-5" });
  });

  it("a budget only lowers the cap, is applied to the effective quotas, and is per tenant", async () => {
    const actor = { userId: fx.orgA.userId };
    const set = await setAiBudget({
      organizationId: fx.orgA.organizationId,
      budget: { tokensPerMonth: 250_000, requestsPerMonth: 500 },
      actor,
    });
    expect(set).toEqual({ ok: true, budget: { tokensPerMonth: 250_000 } });

    const a = await getCurrentTier(fx.orgA.organizationId);
    expect(a?.platformQuotas).toMatchObject({ aiTokensPerMonth: 1_000_000, aiRequestsPerMonth: 100 });
    expect(a?.effectiveQuotas).toMatchObject({ aiTokensPerMonth: 250_000, aiRequestsPerMonth: 100 });
    // The pinned model override survived the budget write.
    expect(a?.overrides.aiModels).toEqual({ proposal_scan: "claude-opus-5" });

    const state = await getAiControlState({ organizationId: fx.orgA.organizationId });
    expect(state).toMatchObject({
      hasSubscription: true,
      tierName: "Control A",
      platformTokenCap: 1_000_000,
      effectiveTokenCap: 250_000,
      effectiveRequestCap: 100,
      budget: { tokensPerMonth: 250_000 },
    });

    // B (unlimited tier) accepts any positive budget and is untouched by A's.
    const b = await getCurrentTier(fx.orgB.organizationId);
    expect(b?.effectiveQuotas.aiTokensPerMonth).toBe(0);
    await setAiBudget({ organizationId: fx.orgB.organizationId, budget: { tokensPerMonth: 42 }, actor: { userId: fx.orgB.userId } });
    expect((await getCurrentTier(fx.orgB.organizationId))?.effectiveQuotas.aiTokensPerMonth).toBe(42);
    expect((await getCurrentTier(fx.orgA.organizationId))?.effectiveQuotas.aiTokensPerMonth).toBe(250_000);

    // Clearing.
    await setAiBudget({ organizationId: fx.orgA.organizationId, budget: {}, actor });
    expect((await getCurrentTier(fx.orgA.organizationId))?.effectiveQuotas.aiTokensPerMonth).toBe(1_000_000);
  });

  it("reads month-to-date usage from the tenant's own ledger rows only", async () => {
    const since = new Date(Date.now() - 60_000);
    await db.insert(aiCallLogs).values([
      { organizationId: fx.orgA.organizationId, feature: "section_draft", status: "ok", inputTokens: 1_000, outputTokens: 500, latencyMs: 10 },
      { organizationId: fx.orgA.organizationId, feature: "section_draft", status: "error", inputTokens: 0, outputTokens: 0, latencyMs: 5 },
      { organizationId: fx.orgA.organizationId, feature: "opportunity_brief", status: "quota_refused", latencyMs: 0 },
      { organizationId: fx.orgB.organizationId, feature: "section_draft", status: "ok", inputTokens: 9_000, outputTokens: 9_000, latencyMs: 10 },
    ]);
    const a = await getTenantAiUsage({ organizationId: fx.orgA.organizationId, since });
    expect(a.byFeature.map((f) => [f.feature, f.calls, f.errors, f.quotaRefused, f.inputTokens + f.outputTokens])).toEqual([
      ["section_draft", 2, 1, 0, 1_500],
      ["opportunity_brief", 1, 0, 1, 0],
    ]);
    expect(a.daily).toHaveLength(1);
    expect(a.daily[0]).toMatchObject({ tokens: 1_500, calls: 3 });
    expect(a.daily[0]!.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const b = await getTenantAiUsage({ organizationId: fx.orgB.organizationId, since });
    expect(b.byFeature.map((f) => [f.feature, f.inputTokens + f.outputTokens])).toEqual([["section_draft", 18_000]]);
  });
});
