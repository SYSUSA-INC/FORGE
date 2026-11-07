/**
 * BL-NAV-LIFECYCLE 2c — Analyze against Postgres, two tenants, the AI
 * mocked: a run keeps the next Analysis Report version with the model's
 * PWin and the AI's call and lines, counts one AI request (the brief is
 * reused or written alongside), and Evaluate reads its call; with no AI
 * provider the report is written from the facts and says so; a failed AI
 * read refunds the request and keeps nothing; another tenant's
 * opportunity is refused.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { opportunityReports, tenantUsageCounters } from "@/db/schema";
import { createTierAndSubscribe, createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const ai = vi.hoisted(() => ({ live: true, analysis: null as unknown, calls: [] as string[] }));
vi.mock("@/lib/ai", async (orig) => {
  const real = await orig<typeof import("@/lib/ai")>();
  return {
    ...real,
    getAIProviderStatus: () => ({ ...real.getAIProviderStatus(), active: { ...real.getAIProviderStatus().active, name: ai.live ? "anthropic" : "stub" } }),
    completeStructuredForTenant: async (o: { feature: string }) => {
      ai.calls.push(o.feature);
      if (o.feature === "opportunity_brief") return { data: { brief: "Watch: fit is good, incumbent strong.", recommendation: "watch", confidence: 0.6, keySignals: ["NAICS fit"], nextActions: ["Find the incumbent"] }, text: "", model: "m", stubbed: !ai.live, parseError: null };
      return { data: ai.analysis, text: "", model: "claude-test", stubbed: false, parseError: ai.analysis ? null : "invalid" };
    },
  };
});

const { runAnalysis } = await import("@/lib/opportunity-analysis");
const { evaluateSignals } = await import("@/lib/opportunity-decision-store");
const { asAnalysisReport } = await import("@/lib/opportunity-report");

const GOOD = { call: "pursue", summary: "Pursue: the fit is strong and the gaps can be partnered.", fit: ["NAICS 541512 is the company's own"], competition: ["Incumbent not named yet"], risks: ["Due in 10 days"], raisePwin: ["Name the incumbent"] };

describe("BL-NAV-LIFECYCLE 2c — Analyze", () => {
  let fx: TwoTenantFixture;
  let tier: { cleanup: () => Promise<void> };

  beforeEach(async () => {
    ai.live = true;
    ai.analysis = GOOD;
    ai.calls = [];
    fx = await createTwoTenants("opportunity-analysis");
    tier = await createTierAndSubscribe({ organizationId: fx.orgA.organizationId, slug: `an-${Date.now()}`, name: "AN", featureFlags: { aiAutoDraft: true }, quotas: { aiRequestsPerMonth: 100 } });
  });

  afterEach(async () => {
    await tier.cleanup();
    await fx.cleanup();
  });

  const actor = () => ({ userId: fx.orgA.userId, email: null });
  const used = async () => (await db.select({ v: tenantUsageCounters.value }).from(tenantUsageCounters).where(and(eq(tenantUsageCounters.organizationId, fx.orgA.organizationId), eq(tenantUsageCounters.key, "aiRequestsPerMonth"))))[0]?.v ?? 0;

  it("keeps the next Analysis Report with the model's PWin and the AI's call, counted once, read by Evaluate", async () => {
    const first = await runAnalysis({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, actor: actor() });
    expect(first).toMatchObject({ ok: true, version: 1 });
    const second = await runAnalysis({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, actor: actor() });
    expect(second).toMatchObject({ ok: true, version: 2 });
    const [row] = await db.select().from(opportunityReports).where(eq(opportunityReports.id, first.ok ? first.id : ""));
    const body = asAnalysisReport(row!.body)!;
    expect(body).toMatchObject({ call: "pursue", stubbed: false, model: "claude-test", fit: GOOD.fit });
    expect(body.pwin === null || typeof body.pwin.pwin === "number").toBe(true);
    expect(body.sources.some((s) => s.startsWith("AI pursuit brief"))).toBe(true);
    expect(ai.calls.filter((f) => f === "analysis_report")).toHaveLength(2);
    expect(await used()).toBe(2);
    expect((await evaluateSignals(fx.orgA.organizationId, [fx.orgA.opportunityId])).get(fx.orgA.opportunityId)).toMatchObject({ analysed: true, call: "pursue" });
  });

  it("writes from the facts with no AI provider, and says so", async () => {
    ai.live = false;
    const res = await runAnalysis({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, actor: actor() });
    expect(res.ok).toBe(true);
    const [row] = await db.select().from(opportunityReports).where(eq(opportunityReports.id, res.ok ? res.id : ""));
    expect(asAnalysisReport(row!.body)).toMatchObject({ stubbed: true });
    expect(ai.calls).not.toContain("analysis_report");
  });

  it("refunds a failed AI read and keeps nothing", async () => {
    ai.analysis = null;
    const res = await runAnalysis({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, actor: actor() });
    expect(res.ok).toBe(false);
    expect(await db.select().from(opportunityReports).where(eq(opportunityReports.opportunityId, fx.orgA.opportunityId))).toHaveLength(0);
    expect(await used()).toBe(0);
  });

  it("refuses another tenant's opportunity", async () => {
    expect(await runAnalysis({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgB.opportunityId, actor: actor() })).toEqual({ ok: false, error: "Opportunity not found." });
    expect(await db.select().from(opportunityReports).where(eq(opportunityReports.opportunityId, fx.orgB.opportunityId))).toHaveLength(0);
  });
});
