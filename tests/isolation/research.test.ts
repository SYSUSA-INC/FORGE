/**
 * BL-NAV-LIFECYCLE 5b — web research against Postgres. Two tenants.
 * Asserts: tenant B cannot read or change tenant A's research settings,
 * sources or usage; the search allowance is counted and capped per tenant
 * (a missing quota is none, the tenant's own cap only lowers the plan's,
 * and racing runs cannot pass it); the sources are kept to their tenant
 * and a draft reads a proposal's sources only while research is on, with
 * a read audit row.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, proposalResearchSources } from "@/db/schema";
import { getResearchSettings, getResearchState, listResearchSources, replaceResearchSources, researchSourcesForDraft, setResearchSettings } from "@/lib/research-store";
import { getCurrentUsage, getWebSearchAllowance, releaseWebSearches, reserveWebSearches } from "@/lib/subscription-gates";
import { createTierAndSubscribe, createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

describe("BL-NAV-LIFECYCLE 5b — web research", () => {
  let fx: TwoTenantFixture;
  let tiers: { cleanup: () => Promise<void> }[] = [];
  const tag = Date.now().toString(36);

  const actorA = () => ({ userId: fx.orgA.userId, email: "a@test" });

  beforeEach(async () => {
    fx = await createTwoTenants("research");
    tiers = [
      await createTierAndSubscribe({ organizationId: fx.orgA.organizationId, slug: `rs-a-${tag}`, name: "RS A", featureFlags: { aiAutoDraft: true }, quotas: { webSearchesPerMonth: 7 } }),
      // Tenant B's plan includes no web searches.
      await createTierAndSubscribe({ organizationId: fx.orgB.organizationId, slug: `rs-b-${tag}`, name: "RS B", featureFlags: { aiAutoDraft: true } }),
    ];
  });

  afterEach(async () => {
    for (const t of tiers) await t.cleanup();
    await fx.cleanup();
  });

  it("keeps each tenant's settings to itself and audits the change", async () => {
    expect(await getResearchSettings(fx.orgA.organizationId)).toMatchObject({ enabled: false });
    const set = await setResearchSettings({
      organizationId: fx.orgA.organizationId,
      input: { enabled: true, allowedDomains: "agency.gov\nusaspending.gov", blockedDomains: "bad.com", monthlyCap: 3 },
      actor: actorA(),
    });
    expect(set).toMatchObject({ ok: true, settings: { enabled: true, monthlyCap: 3 } });
    expect(await getResearchSettings(fx.orgA.organizationId)).toEqual({ enabled: true, allowedDomains: ["agency.gov", "usaspending.gov"], blockedDomains: ["bad.com"], monthlyCap: 3 });
    // B still has research off, no lists, no cap.
    expect(await getResearchSettings(fx.orgB.organizationId)).toEqual({ enabled: false, allowedDomains: [], blockedDomains: [], monthlyCap: null });
    expect((await getResearchState({ organizationId: fx.orgB.organizationId })).settings.enabled).toBe(false);
    const rows = await db.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "ai_engine.research.update")));
    expect(rows).toHaveLength(1);
    const none = await db.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgB.organizationId), eq(auditLogs.action, "ai_engine.research.update")));
    expect(none).toHaveLength(0);

    // A bad domain is refused and nothing changes; a switch-off keeps the other overrides.
    const bad = await setResearchSettings({ organizationId: fx.orgA.organizationId, input: { enabled: true, allowedDomains: "not a domain" }, actor: actorA() });
    expect(bad).toMatchObject({ ok: false });
    expect((await getResearchSettings(fx.orgA.organizationId)).monthlyCap).toBe(3);
  });

  it("counts and caps searches per tenant: none without a plan allowance, the tenant's cap only lowers", async () => {
    const orgA = fx.orgA.organizationId;
    const orgB = fx.orgB.organizationId;
    expect(await getWebSearchAllowance(orgA)).toMatchObject({ planAllowance: 7, cap: 7, used: 0, remaining: 7 });
    expect(await getWebSearchAllowance(orgB)).toMatchObject({ planAllowance: 0, cap: 0, remaining: 0 });

    // B's plan has no allowance: nothing is reserved, however often it asks.
    expect((await reserveWebSearches(orgB, 5)).reserved).toBe(0);
    expect(await getCurrentUsage(orgB, "webSearchesPerMonth")).toBe(0);

    expect((await reserveWebSearches(orgA, 5)).reserved).toBe(5);
    expect((await reserveWebSearches(orgA, 5)).reserved).toBe(2);
    expect((await reserveWebSearches(orgA, 5)).reserved).toBe(0);
    expect(await getCurrentUsage(orgA, "webSearchesPerMonth")).toBe(7);
    // A's use did not touch B.
    expect(await getCurrentUsage(orgB, "webSearchesPerMonth")).toBe(0);

    await releaseWebSearches(orgA, 4);
    expect(await getCurrentUsage(orgA, "webSearchesPerMonth")).toBe(3);
    await releaseWebSearches(orgA, 100);
    expect(await getCurrentUsage(orgA, "webSearchesPerMonth")).toBe(0);

    // The tenant's own cap lowers the plan's allowance.
    await setResearchSettings({ organizationId: orgA, input: { enabled: true, monthlyCap: 3 }, actor: actorA() });
    expect(await getWebSearchAllowance(orgA)).toMatchObject({ planAllowance: 7, cap: 3, remaining: 3 });
    expect((await reserveWebSearches(orgA, 5)).reserved).toBe(3);
    expect((await reserveWebSearches(orgA, 5)).reserved).toBe(0);
    // A cap above the plan does not raise it.
    await setResearchSettings({ organizationId: orgA, input: { enabled: true, monthlyCap: 9000 }, actor: actorA() });
    expect((await getWebSearchAllowance(orgA)).cap).toBe(7);
  });

  it("cannot be overspent by runs racing for the last searches", async () => {
    const orgA = fx.orgA.organizationId;
    const results = await Promise.all(Array.from({ length: 6 }, () => reserveWebSearches(orgA, 3)));
    const total = results.reduce((n, r) => n + r.reserved, 0);
    expect(total).toBeLessThanOrEqual(7);
    expect(await getCurrentUsage(orgA, "webSearchesPerMonth")).toBe(total);
    expect(total).toBeGreaterThanOrEqual(6);
  });

  it("keeps research sources to the owning tenant and audits the read", async () => {
    const orgA = fx.orgA.organizationId;
    const orgB = fx.orgB.organizationId;
    const stored = await replaceResearchSources({
      organizationId: orgA,
      proposalId: fx.orgA.proposalId,
      userId: fx.orgA.userId,
      sources: [{ ordinal: 1, url: "https://agency.gov/strategy", title: "Strategy", excerpt: "The agency will consolidate data centers.", pageAge: null }],
      retrievedAt: new Date("2026-11-16T10:00:00Z"),
    });
    expect(stored).toBe(1);

    // B cannot list, replace or draft from A's sources, and A's set is untouched.
    expect(await listResearchSources({ organizationId: orgB, proposalId: fx.orgA.proposalId })).toEqual([]);
    expect(await replaceResearchSources({ organizationId: orgB, proposalId: fx.orgA.proposalId, userId: null, sources: [], retrievedAt: new Date() })).toBe(0);
    expect(await listResearchSources({ organizationId: orgA, proposalId: fx.orgA.proposalId })).toHaveLength(1);
    await setResearchSettings({ organizationId: orgB, input: { enabled: true }, actor: { userId: fx.orgB.userId } });
    expect(await researchSourcesForDraft({ organizationId: orgB, proposalId: fx.orgA.proposalId, firstIndex: 1, actor: { userId: fx.orgB.userId } })).toEqual([]);

    // A drafts from them only while research is on; they are numbered after the company's own.
    expect(await researchSourcesForDraft({ organizationId: orgA, proposalId: fx.orgA.proposalId, firstIndex: 4, actor: actorA() })).toEqual([]);
    await setResearchSettings({ organizationId: orgA, input: { enabled: true }, actor: actorA() });
    const web = await researchSourcesForDraft({ organizationId: orgA, proposalId: fx.orgA.proposalId, firstIndex: 4, actor: actorA() });
    expect(web).toHaveLength(1);
    expect(web[0]).toMatchObject({ index: 4, kind: "web", href: "https://agency.gov/strategy", excerpt: "The agency will consolidate data centers." });
    expect(web[0]!.label).toBe("Strategy — agency.gov (retrieved 2026-11-16)");
    const reads = await db.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.organizationId, orgA), eq(auditLogs.action, "proposal.draft.research")));
    expect(reads).toHaveLength(1);
    const bReads = await db.select({ id: auditLogs.id }).from(auditLogs).where(and(eq(auditLogs.organizationId, orgB), eq(auditLogs.action, "proposal.draft.research")));
    expect(bReads).toHaveLength(0);

    // A new run replaces the set whole.
    await replaceResearchSources({ organizationId: orgA, proposalId: fx.orgA.proposalId, userId: null, sources: [], retrievedAt: new Date() });
    expect(await db.select({ id: proposalResearchSources.id }).from(proposalResearchSources).where(eq(proposalResearchSources.proposalId, fx.orgA.proposalId))).toHaveLength(0);
  });
});
