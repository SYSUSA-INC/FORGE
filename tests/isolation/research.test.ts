/**
 * BL-NAV-LIFECYCLE 5b — web research against Postgres. Two tenants.
 * Asserts: tenant B cannot read or change tenant A's research settings,
 * sources or usage; the search allowance is counted and capped per tenant
 * (a missing quota is none, the tenant's own cap only lowers the plan's,
 * and racing runs cannot pass it); a run in stub mode, with research off
 * or past the cap spends nothing; a run keeps cited pages that pass the
 * lists, gives back the searches it did not use, and writes its audit
 * rows; draft-all queues the research step first only when it can run,
 * and a section draft waits for it without spending an attempt.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, backgroundJobs, proposalResearchSources } from "@/db/schema";
import { __setCompleteImplForTest, type AICompleteResult } from "@/lib/ai";
import { researchPending, researchProgress, startAutoDraft } from "@/lib/auto-draft";
import { executeJob } from "@/lib/jobs";
import { JOB_STUCK_AFTER_MS, JobPermanentError } from "@/lib/jobs-policy";
import { runProposalResearch } from "@/lib/research-job";
import { getResearchSettings, getResearchState, listResearchSources, replaceResearchSources, researchSourcesForDraft, setResearchSettings } from "@/lib/research-store";
import { getCurrentUsage, getWebSearchAllowance, releaseWebSearches, reserveWebSearches } from "@/lib/subscription-gates";
import { proposalSections } from "@/db/schema";
import { createTierAndSubscribe, createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

describe("BL-NAV-LIFECYCLE 5b — web research", () => {
  let fx: TwoTenantFixture;
  let tiers: { cleanup: () => Promise<void> }[] = [];
  const tag = Date.now().toString(36);
  const saved = { provider: process.env.AI_PROVIDER, key: process.env.ANTHROPIC_API_KEY };

  const actorA = () => ({ userId: fx.orgA.userId, email: "a@test" });
  const asAnthropic = () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "test-key";
  };
  const searched = (requests: number, citations: { url: string; title: string; citedText: string }[]): AICompleteResult => ({
    text: "Findings.",
    provider: "anthropic",
    model: "test-model",
    stubbed: false,
    inputTokens: 10,
    outputTokens: 10,
    webSearch: { requests, citations, pageAges: { "https://agency.gov/strategy": "May 1, 2026" } },
  });

  beforeEach(async () => {
    fx = await createTwoTenants("research");
    tiers = [
      await createTierAndSubscribe({ organizationId: fx.orgA.organizationId, slug: `rs-a-${tag}`, name: "RS A", featureFlags: { aiAutoDraft: true }, quotas: { webSearchesPerMonth: 7 } }),
      // Tenant B's plan includes no web searches.
      await createTierAndSubscribe({ organizationId: fx.orgB.organizationId, slug: `rs-b-${tag}`, name: "RS B", featureFlags: { aiAutoDraft: true } }),
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

  it("does nothing, and spends nothing, in stub mode, with research off, or past the cap", async () => {
    const orgA = fx.orgA.organizationId;
    const run = () => runProposalResearch({ organizationId: orgA, proposalId: fx.orgA.proposalId, userId: fx.orgA.userId });

    // Off (the default).
    expect(await run()).toMatchObject({ ok: false, skipped: expect.stringContaining("off") });

    // On, but no provider key: stub mode, so no search and no reservation.
    delete process.env.ANTHROPIC_API_KEY;
    process.env.AI_PROVIDER = "stub";
    await setResearchSettings({ organizationId: orgA, input: { enabled: true }, actor: actorA() });
    expect(await run()).toMatchObject({ ok: false, skipped: expect.stringContaining("stub mode") });
    expect(await getCurrentUsage(orgA, "webSearchesPerMonth")).toBe(0);

    // Provider ready but the allowance is spent: the model is never called.
    asAnthropic();
    let called = 0;
    __setCompleteImplForTest(async () => {
      called += 1;
      return searched(1, []);
    });
    await reserveWebSearches(orgA, 5);
    await reserveWebSearches(orgA, 5);
    expect(await run()).toMatchObject({ ok: false, skipped: expect.stringContaining("allowance is used") });
    expect(called).toBe(0);

    // The other tenant has no allowance at all: skipped, never called, A's use untouched.
    await setResearchSettings({ organizationId: fx.orgB.organizationId, input: { enabled: true }, actor: { userId: fx.orgB.userId } });
    const b = await runProposalResearch({ organizationId: fx.orgB.organizationId, proposalId: fx.orgB.proposalId, userId: fx.orgB.userId });
    expect(b).toMatchObject({ ok: false, skipped: expect.stringContaining("No web searches") });
    expect(called).toBe(0);
    expect(await getCurrentUsage(orgA, "webSearchesPerMonth")).toBe(7);
  });

  it("stores what the model cited that passes the lists, gives back unused searches and audits the run", async () => {
    const orgA = fx.orgA.organizationId;
    asAnthropic();
    await setResearchSettings({ organizationId: orgA, input: { enabled: true, blockedDomains: "bad.com" }, actor: actorA() });
    let maxUses = 0;
    __setCompleteImplForTest(async (opts) => {
      maxUses = opts.webSearch?.maxUses ?? 0;
      expect(opts.webSearch?.blockedDomains).toEqual(["bad.com"]);
      expect(opts.system).toMatch(/UNTRUSTED/);
      return searched(2, [
        { url: "https://agency.gov/strategy", title: "Strategy", citedText: "Consolidate data centers by 2028." },
        { url: "https://www.bad.com/ad", title: "Ad", citedText: "Buy now." },
      ]);
    });
    const res = await runProposalResearch({ organizationId: orgA, proposalId: fx.orgA.proposalId, userId: fx.orgA.userId });
    expect(res).toEqual({ ok: true, searches: 2, sources: 1 });
    expect(maxUses).toBe(5);
    // 5 reserved, 2 used: 3 were given back.
    expect(await getCurrentUsage(orgA, "webSearchesPerMonth")).toBe(2);
    const sources = await listResearchSources({ organizationId: orgA, proposalId: fx.orgA.proposalId });
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ ordinal: 1, url: "https://agency.gov/strategy", pageAge: "May 1, 2026" });
    const audit = await db.select({ metadata: auditLogs.metadata }).from(auditLogs).where(and(eq(auditLogs.organizationId, orgA), eq(auditLogs.action, "proposal.research.run")));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({ searches: 2, reserved: 5, sources: 1 });

    // Tenant B cannot run research on A's proposal: refused before anything is reserved.
    await setResearchSettings({ organizationId: fx.orgB.organizationId, input: { enabled: true }, actor: { userId: fx.orgB.userId } });
    await expect(runProposalResearch({ organizationId: fx.orgB.organizationId, proposalId: fx.orgA.proposalId, userId: null })).rejects.toBeInstanceOf(JobPermanentError);
    expect(await getCurrentUsage(fx.orgB.organizationId, "webSearchesPerMonth")).toBe(0);
  });

  it("gives every search back when the call fails or the provider does not search", async () => {
    const orgA = fx.orgA.organizationId;
    asAnthropic();
    await setResearchSettings({ organizationId: orgA, input: { enabled: true }, actor: actorA() });
    __setCompleteImplForTest(async () => {
      throw new Error("provider down");
    });
    await expect(runProposalResearch({ organizationId: orgA, proposalId: fx.orgA.proposalId, userId: null })).rejects.toThrow("provider down");
    expect(await getCurrentUsage(orgA, "webSearchesPerMonth")).toBe(0);

    __setCompleteImplForTest(async () => ({ text: "plain answer", provider: "anthropic", model: "m", stubbed: false }));
    expect(await runProposalResearch({ organizationId: orgA, proposalId: fx.orgA.proposalId, userId: null })).toMatchObject({ ok: false, skipped: expect.stringContaining("did not run a web search") });
    expect(await getCurrentUsage(orgA, "webSearchesPerMonth")).toBe(0);
    expect(await listResearchSources({ organizationId: orgA, proposalId: fx.orgA.proposalId })).toEqual([]);
  });

  it("queues the research step before the section drafts only when it can run", async () => {
    const orgA = fx.orgA.organizationId;
    await db.insert(proposalSections).values({ proposalId: fx.orgA.proposalId, kind: "technical", title: "Technical approach", ordering: 1 });
    const start = () => startAutoDraft({ organizationId: orgA, proposalId: fx.orgA.proposalId, userId: fx.orgA.userId, overwrite: false, kick: false });
    const researchJobs = () => db.select({ id: backgroundJobs.id }).from(backgroundJobs).where(and(eq(backgroundJobs.organizationId, orgA), eq(backgroundJobs.kind, "proposal_research")));

    // Research off: only the section job.
    asAnthropic();
    expect(await start()).toEqual({ ok: true, queued: 1 });
    expect(await researchJobs()).toHaveLength(0);
    expect(await researchProgress({ organizationId: orgA, proposalId: fx.orgA.proposalId })).toBeNull();

    // On and ready: one research job, reused on a second click; none for the other tenant.
    await db.delete(backgroundJobs).where(eq(backgroundJobs.organizationId, orgA));
    await setResearchSettings({ organizationId: orgA, input: { enabled: true }, actor: actorA() });
    await start();
    await start();
    expect(await researchJobs()).toHaveLength(1);
    expect(await researchProgress({ organizationId: orgA, proposalId: fx.orgA.proposalId })).toMatchObject({ status: "queued" });
    expect(await researchProgress({ organizationId: fx.orgB.organizationId, proposalId: fx.orgA.proposalId })).toBeNull();

    // A section draft waits for the research step without spending an attempt.
    const [sectionJob] = await db.select({ id: backgroundJobs.id }).from(backgroundJobs).where(and(eq(backgroundJobs.organizationId, orgA), eq(backgroundJobs.kind, "section_auto_draft")));
    expect(await executeJob(sectionJob!.id, orgA, { viaCron: true })).toEqual({ ran: false, reason: "waiting" });
    const [waiting] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, sectionJob!.id));
    expect(waiting).toMatchObject({ status: "queued", attempts: 0 });
    expect(waiting!.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    // A research run that died with its instance stops holding the drafts; the other tenant's view is unchanged.
    expect(await researchPending(orgA, fx.orgA.proposalId)).toBe(true);
    expect(await researchPending(fx.orgB.organizationId, fx.orgA.proposalId)).toBe(false);
    await db.update(backgroundJobs).set({ status: "running", startedAt: new Date(Date.now() - JOB_STUCK_AFTER_MS - 1000) }).where(and(eq(backgroundJobs.organizationId, orgA), eq(backgroundJobs.kind, "proposal_research")));
    expect(await researchPending(orgA, fx.orgA.proposalId)).toBe(false);

    // Stub mode: no research job, drafts still queue.
    await db.delete(backgroundJobs).where(eq(backgroundJobs.organizationId, orgA));
    process.env.AI_PROVIDER = "stub";
    delete process.env.ANTHROPIC_API_KEY;
    expect(await start()).toEqual({ ok: true, queued: 1 });
    expect(await researchJobs()).toHaveLength(0);
  });
});
