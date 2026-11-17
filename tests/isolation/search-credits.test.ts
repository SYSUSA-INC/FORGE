/**
 * BL-NAV-LIFECYCLE 5b-2a — prepaid web-search packs: the balance and its ledger.
 * Asserts: tenant B cannot see, draw or change tenant A's pack balance; a
 * reservation takes the plan's searches first and the pack only for the
 * rest; a give-back returns to the pack first; racing draws cannot pass
 * zero; a correction never takes a balance below zero and is audited; the
 * balance always equals the sum of its ledger entries; a research run on a
 * plan with no searches draws the pack and gives back what it did not use.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, searchCreditEntries, tenantSearchCredits } from "@/db/schema";
import { __setCompleteImplForTest } from "@/lib/ai";
import { runProposalResearch } from "@/lib/research-job";
import { setResearchSettings } from "@/lib/research-store";
import { adjustSearchCredits, drawSearchCredits, getSearchCreditBalance, listSearchCreditEntries } from "@/lib/search-credits";
import { getCurrentUsage, getWebSearchAllowance, releaseWebSearches, reserveWebSearches } from "@/lib/subscription-gates";
import { createTierAndSubscribe, createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

describe("BL-NAV-LIFECYCLE 5b-2a — search packs", () => {
  let fx: TwoTenantFixture;
  let tiers: { cleanup: () => Promise<void> }[] = [];
  const tag = Date.now().toString(36);
  const saved = { provider: process.env.AI_PROVIDER, key: process.env.ANTHROPIC_API_KEY };

  const credit = (organizationId: string, delta: number) =>
    adjustSearchCredits({ organizationId, delta, note: "test", actor: { userId: null } });
  const ledgerSum = async (organizationId: string) => {
    const [row] = await db
      .select({ sum: sql<number>`coalesce(sum(${searchCreditEntries.delta}), 0)::int` })
      .from(searchCreditEntries)
      .where(eq(searchCreditEntries.organizationId, organizationId));
    return row!.sum;
  };

  beforeEach(async () => {
    fx = await createTwoTenants("packs");
    tiers = [
      // A: 7 searches a month on the plan. B: a plan with none.
      await createTierAndSubscribe({ organizationId: fx.orgA.organizationId, slug: `sp-a-${tag}`, name: "SP A", featureFlags: { aiAutoDraft: true }, quotas: { webSearchesPerMonth: 7 } }),
      await createTierAndSubscribe({ organizationId: fx.orgB.organizationId, slug: `sp-b-${tag}`, name: "SP B", featureFlags: { aiAutoDraft: true } }),
    ];
  });

  afterEach(async () => {
    __setCompleteImplForTest(null);
    if (saved.provider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = saved.provider;
    if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved.key;
    for (const t of tiers) await t.cleanup();
    await fx.cleanup();
  });

  it("keeps a balance to its tenant and never takes a correction below zero", async () => {
    const orgA = fx.orgA.organizationId;
    const orgB = fx.orgB.organizationId;
    expect(await getSearchCreditBalance(orgA)).toBe(0);

    expect(await credit(orgA, 10)).toEqual({ ok: true, balance: 10 });
    expect(await getSearchCreditBalance(orgB)).toBe(0);
    expect((await getWebSearchAllowance(orgB)).packBalance).toBe(0);
    expect(await listSearchCreditEntries({ organizationId: orgB })).toEqual([]);

    // B draws from its own (empty) balance only.
    expect(await drawSearchCredits({ organizationId: orgB, want: 5 })).toBe(0);
    expect(await getSearchCreditBalance(orgA)).toBe(10);

    // A removal larger than the balance is refused, not clipped; a note is required.
    expect(await credit(orgA, -11)).toMatchObject({ ok: false });
    expect(await credit(orgB, -1)).toMatchObject({ ok: false });
    expect(await adjustSearchCredits({ organizationId: orgA, delta: 5, note: "  ", actor: { userId: null } })).toMatchObject({ ok: false });
    expect(await credit(orgA, -4)).toEqual({ ok: true, balance: 6 });
    expect(await getSearchCreditBalance(orgA)).toBe(6);
    expect(await ledgerSum(orgA)).toBe(6);

    const audit = await db.select({ metadata: auditLogs.metadata }).from(auditLogs).where(and(eq(auditLogs.organizationId, orgA), eq(auditLogs.action, "admin.search_credit.adjust")));
    expect(audit).toHaveLength(2);
    expect(await db.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.organizationId, orgB), eq(auditLogs.action, "admin.search_credit.adjust")))).toHaveLength(0);
  });

  it("draws the plan first, then the pack, and gives back to the pack first", async () => {
    const orgA = fx.orgA.organizationId;
    await credit(orgA, 4);
    expect(await getWebSearchAllowance(orgA)).toMatchObject({ cap: 7, remaining: 7, packBalance: 4, available: 11 });

    // The plan alone covers the first run: the pack is untouched.
    expect(await reserveWebSearches(orgA, 5)).toMatchObject({ reserved: 5, fromPlan: 5, fromPack: 0 });
    expect(await getSearchCreditBalance(orgA)).toBe(4);

    // The second run takes the plan's last 2 and 3 from the pack.
    const second = await reserveWebSearches(orgA, 5, { proposalId: fx.orgA.proposalId });
    expect(second).toMatchObject({ reserved: 5, fromPlan: 2, fromPack: 3 });
    expect(await getCurrentUsage(orgA, "webSearchesPerMonth")).toBe(7);
    expect(await getSearchCreditBalance(orgA)).toBe(1);

    // It used 1 of 5: the 3 pack searches go back first, then 1 to the plan.
    await releaseWebSearches(orgA, 4, { fromPack: second.fromPack, proposalId: fx.orgA.proposalId });
    expect(await getSearchCreditBalance(orgA)).toBe(4);
    expect(await getCurrentUsage(orgA, "webSearchesPerMonth")).toBe(6);
    expect(await ledgerSum(orgA)).toBe(4);

    // Plan and pack both spent: nothing is reserved, and the other tenant is untouched.
    expect(await reserveWebSearches(orgA, 5)).toMatchObject({ reserved: 5, fromPlan: 1, fromPack: 4 });
    expect(await reserveWebSearches(orgA, 5)).toMatchObject({ reserved: 0, fromPlan: 0, fromPack: 0 });
    expect((await getWebSearchAllowance(orgA)).available).toBe(0);
    expect(await getCurrentUsage(fx.orgB.organizationId, "webSearchesPerMonth")).toBe(0);
    expect(await ledgerSum(orgA)).toBe(0);
  });

  it("never lets racing runs take the pack below zero", async () => {
    // B's plan includes no searches, so every search comes from the pack.
    const orgB = fx.orgB.organizationId;
    await credit(orgB, 4);
    const results = await Promise.all(Array.from({ length: 6 }, () => reserveWebSearches(orgB, 1)));
    expect(results.reduce((sum, r) => sum + r.fromPack, 0)).toBe(4);
    expect(results.every((r) => r.fromPlan === 0)).toBe(true);
    expect(await getSearchCreditBalance(orgB)).toBe(0);
    expect(await ledgerSum(orgB)).toBe(0);
    const [row] = await db.select({ balance: tenantSearchCredits.balance }).from(tenantSearchCredits).where(eq(tenantSearchCredits.organizationId, orgB));
    expect(row!.balance).toBe(0);
  });

  it("runs research on the pack when the plan has no searches, and gives back the unused", async () => {
    const orgB = fx.orgB.organizationId;
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "test-key";
    await setResearchSettings({ organizationId: orgB, input: { enabled: true }, actor: { userId: fx.orgB.userId } });
    await credit(orgB, 5);
    let maxUses = 0;
    __setCompleteImplForTest(async (opts) => {
      maxUses = opts.webSearch?.maxUses ?? 0;
      return {
        text: "Findings.",
        provider: "anthropic",
        model: "test-model",
        stubbed: false,
        webSearch: { requests: 2, citations: [{ url: "https://agency.gov/plan", title: "Plan", citedText: "A public fact." }], pageAges: {} },
      };
    });
    const res = await runProposalResearch({ organizationId: orgB, proposalId: fx.orgB.proposalId, userId: fx.orgB.userId });
    expect(res).toEqual({ ok: true, searches: 2, sources: 1 });
    expect(maxUses).toBe(5);
    // 5 drawn from the pack, 2 used: 3 came back. The plan counter stays at 0.
    expect(await getSearchCreditBalance(orgB)).toBe(3);
    expect(await getCurrentUsage(orgB, "webSearchesPerMonth")).toBe(0);
    expect(await ledgerSum(orgB)).toBe(3);
    const [audit] = await db.select({ metadata: auditLogs.metadata }).from(auditLogs).where(and(eq(auditLogs.organizationId, orgB), eq(auditLogs.action, "proposal.research.run")));
    expect(audit!.metadata).toMatchObject({ searches: 2, reserved: 5, fromPack: 2 });
    // The other tenant's balance and ledger are untouched.
    expect(await getSearchCreditBalance(fx.orgA.organizationId)).toBe(0);
    expect(await listSearchCreditEntries({ organizationId: fx.orgA.organizationId })).toEqual([]);
  });
});
