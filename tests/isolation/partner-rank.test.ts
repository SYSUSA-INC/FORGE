/**
 * BL-NAV-LIFECYCLE 3b — FORGE AI's ranked partner list against Postgres,
 * the AI stubbed: the ranking is recorded as a read, only picks that rest
 * on a returned fact survive, the matrix's No and Partial answers reach
 * the prompt, a failed answer refunds the request quota, and another
 * tenant's opportunity is never ranked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, certFirms, opportunities, opportunityCapabilityMatrices } from "@/db/schema";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

vi.mock("@/lib/usaspending", async (orig) => ({
  ...(await orig<typeof import("@/lib/usaspending")>()),
  searchAwardsByCriteria: vi.fn(async () => ({ ok: true, awards: [], totalRecords: 0 })),
}));
vi.mock("@/lib/samgov", async (orig) => ({ ...(await orig<typeof import("@/lib/samgov")>()), searchSamGovEntities: vi.fn(async () => ({ ok: true, totalRecords: 0, entities: [] })) }));

const refunds: string[] = [];
vi.mock("@/lib/subscription-gates", async (orig) => ({
  ...(await orig<typeof import("@/lib/subscription-gates")>()),
  ensureFeature: vi.fn(async () => undefined),
  enforceQuota: vi.fn(async () => undefined),
  refundQuota: vi.fn(async (_org: string, key: string) => {
    refunds.push(key);
  }),
}));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: vi.fn(async () => ({ ok: true })) }));

type Answer = { stubbed: boolean; data: { ranked: { uei: string; reason: string; facts: number[] }[] } | null };
let answer: Answer = { stubbed: false, data: { ranked: [] } };
const prompts: string[] = [];
vi.mock("@/lib/ai", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai")>()),
  completeStructuredForTenant: vi.fn(async (o: { messages: { content: string }[] }) => {
    prompts.push(o.messages[0]!.content);
    return { ...answer, provider: "test", model: "test", viaTool: true };
  }),
}));

import { rankPartners } from "@/lib/partner-rank";

const UEIS = ["RANKFIRM0001", "RANKFIRM0002"];

describe("BL-NAV-LIFECYCLE 3b — ranked partners", () => {
  let fx: TwoTenantFixture;
  beforeEach(async () => {
    fx = await createTwoTenants("partner-rank");
    refunds.length = 0;
    prompts.length = 0;
    await db.update(opportunities).set({ naicsCode: "541512", agency: "Department of Veterans Affairs", setAside: "SDVOSB Set-Aside", placeOfPerformance: "Norfolk, VA" }).where(eq(opportunities.id, fx.orgA.opportunityId));
    await db.insert(certFirms).values([
      { uei: UEIS[0]!, certType: "sdvosb", firmName: "Rank One LLC", naicsPrimary: "541512", city: "Norfolk", state: "VA" },
      { uei: UEIS[1]!, certType: "8a", firmName: "Rank Two Inc", naicsPrimary: "541512", city: "Austin", state: "TX" },
    ]);
    await db.insert(opportunityCapabilityMatrices).values({
      organizationId: fx.orgA.organizationId,
      opportunityId: fx.orgA.opportunityId,
      questions: [{ id: "q1", text: "Operate a 24x7 tier-2 help desk", refs: [], kind: "shall", area: "Operations" }],
      answers: { q1: { value: "gap_partner", evidence: "", partnerCompanyId: null, updatedAt: "2026-11-01T00:00:00Z", updatedByUserId: fx.orgA.userId } },
    });
  });
  afterEach(async () => {
    await db.delete(certFirms).where(inArray(certFirms.uei, UEIS));
    await fx.cleanup();
  });

  const a = () => ({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, actor: { userId: fx.orgA.userId, email: null } });

  it("keeps grounded picks, drops the rest, shows the AI the gaps, and records the ranking", async () => {
    answer = {
      stubbed: false,
      data: {
        ranked: [
          { uei: UEIS[0]!, reason: "Holds SDVOSB, which keeps the set-aside; based in Norfolk, VA.", facts: [1, 2] },
          { uei: UEIS[1]!, reason: "Holds 9 awards at the VA.", facts: [1] },
          { uei: "MADEUPFIRM001", reason: "Strong firm.", facts: [1] },
        ],
      },
    };
    const res = await rankPartners(a());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ranked.map((r) => r.uei)).toEqual([UEIS[0]]);
    expect(res.dropped).toBe(2);
    expect(res.ranked[0]!.cited.join(" ")).toContain("SDVOSB");
    expect(prompts[0]).toContain("No · Operations: Operate a 24x7 tier-2 help desk");
    const [row] = await db.select({ metadata: auditLogs.metadata }).from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "opportunity.partner.rank")));
    expect(row?.metadata).toMatchObject({ category: "read", gaps: 1, ranked: 1, dropped: 2 });
    expect(refunds).toEqual([]);
  });

  it("refunds the quota when the AI is stubbed, answers badly, or nothing it says rests on a fact", async () => {
    answer = { stubbed: true, data: null };
    expect(await rankPartners(a())).toMatchObject({ ok: false, error: expect.stringMatching(/stub mode/) });
    answer = { stubbed: false, data: null };
    expect((await rankPartners(a())).ok).toBe(false);
    answer = { stubbed: false, data: { ranked: [{ uei: UEIS[0]!, reason: "Won $99M.", facts: [1] }] } };
    expect(await rankPartners(a())).toMatchObject({ ok: false, error: expect.stringMatching(/didn't rest on facts/) });
    expect(refunds).toHaveLength(3);
  });

  it("never ranks another tenant's opportunity", async () => {
    const res = await rankPartners({ ...a(), opportunityId: fx.orgB.opportunityId });
    expect(res).toEqual({ ok: false, error: "Opportunity not found." });
    expect(prompts).toHaveLength(0);
    expect(refunds).toHaveLength(1);
  });
});
