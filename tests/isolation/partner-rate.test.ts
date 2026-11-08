/**
 * BL-NAV-LIFECYCLE 3c-2 — FORGE AI's partner rating against Postgres, the
 * AI stubbed: the order is the score's, a reason survives only when it
 * rests on the partner's facts, the rating is recorded as a read, a
 * failed answer refunds the request quota, declined partners and those
 * without answers are left out, and another tenant's opportunity is
 * never rated.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, companies, opportunityCapabilityMatrices, opportunityPartners } from "@/db/schema";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

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

type Answer = { stubbed: boolean; data: { rated: { partnerId: string; reason: string; facts: number[] }[] } | null };
let answer: Answer = { stubbed: false, data: { rated: [] } };
const prompts: string[] = [];
vi.mock("@/lib/ai", async (orig) => ({
  ...(await orig<typeof import("@/lib/ai")>()),
  completeStructuredForTenant: vi.fn(async (o: { messages: { content: string }[] }) => {
    prompts.push(o.messages[0]!.content);
    return { ...answer, provider: "test", model: "test", viaTool: true };
  }),
}));

import { ratePartners } from "@/lib/partner-rate";

describe("BL-NAV-LIFECYCLE 3c-2 — partner rating", () => {
  let fx: TwoTenantFixture;
  const ids: Record<string, string> = {};
  const at = "2026-11-05T00:00:00Z";

  async function partner(name: string, answers: Record<string, { answer: "yes" | "partial" | "no"; percent?: number | null; evidence?: string }>, status: "answered" | "declined" | "candidate" = "answered") {
    const [co] = await db.insert(companies).values({ organizationId: fx.orgA.organizationId, name, relationship: "teaming_partner" }).returning({ id: companies.id });
    const [row] = await db
      .insert(opportunityPartners)
      .values({
        organizationId: fx.orgA.organizationId,
        opportunityId: fx.orgA.opportunityId,
        companyId: co!.id,
        status,
        partnerAnswers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, { answer: v.answer, percent: v.percent ?? null, evidence: v.evidence ?? "", updatedAt: at }])),
        certifications: name === "Beta" ? { iso: ["ISO 9001"], cmmcLevel: 2 } : {},
        answeredAt: Object.keys(answers).length ? new Date(at) : null,
      })
      .returning({ id: opportunityPartners.id });
    ids[name] = row!.id;
  }

  beforeEach(async () => {
    fx = await createTwoTenants("partner-rate");
    refunds.length = 0;
    prompts.length = 0;
    await db.insert(opportunityCapabilityMatrices).values({
      organizationId: fx.orgA.organizationId,
      opportunityId: fx.orgA.opportunityId,
      questions: [
        { id: "s1", text: "Operate a 24x7 tier-2 help desk", refs: [], kind: "shall", area: "Operations" },
        { id: "q1", text: "Hold FedRAMP Moderate", refs: ["C.3"], kind: "should", area: "Security" },
      ],
      answers: {
        s1: { value: "gap_partner", evidence: "", partnerCompanyId: null, updatedAt: at, updatedByUserId: fx.orgA.userId },
        q1: { value: "partial", percent: 40, evidence: "", partnerCompanyId: null, updatedAt: at, updatedByUserId: fx.orgA.userId },
      },
    });
    await partner("Alpha", { s1: { answer: "yes", evidence: "VA desk since 2021" }, q1: { answer: "no" } });
    await partner("Beta", { s1: { answer: "no" }, q1: { answer: "partial", percent: 80 } });
    await partner("Gone", { s1: { answer: "yes" } }, "declined");
    await partner("Quiet", {}, "candidate");
  });
  afterEach(async () => {
    await fx.cleanup();
  });

  const a = () => ({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, actor: { userId: fx.orgA.userId, email: null } });

  it("orders by the score, keeps grounded reasons, drops the rest, and records the rating", async () => {
    answer = {
      stubbed: false,
      data: {
        rated: [
          { partnerId: ids.Beta!, reason: "Partial 80% on FedRAMP where we answered Partial 40%, but leaves the help desk open.", facts: [3, 4] },
          { partnerId: ids.Alpha!, reason: "Holds 17 contracts.", facts: [1] },
          { partnerId: ids.Gone!, reason: "Closes 1 of our 2 gaps.", facts: [2] },
        ],
      },
    };
    const res = await ratePartners(a());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Alpha closes the shall gap in full; Beta narrows the should gap and holds certifications.
    expect(res.rated.map((r) => r.name)).toEqual(["Alpha", "Beta"]);
    expect(res.rated[0]).toMatchObject({ closed: 1, gaps: 2, evidenced: 1, reason: null });
    expect(res.rated[1]).toMatchObject({ closed: 1, certifications: ["ISO 9001", "CMMC L2"] });
    expect(res.rated[1]!.reason).toContain("Partial 80%");
    expect(res.rated[1]!.cited).toHaveLength(2);
    expect(res.dropped).toBe(2);
    expect(res.gaps).toBe(2);
    expect(prompts[0]).toContain(`partnerId ${ids.Alpha}`);
    expect(prompts[0]).not.toContain("Gone");
    expect(prompts[0]).not.toContain("Quiet");
    const [row] = await db.select({ metadata: auditLogs.metadata }).from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "opportunity.partner.rate")));
    expect(row?.metadata).toMatchObject({ category: "read", gaps: 2, partners: 2, reasons: 1, dropped: 2, order: [ids.Alpha, ids.Beta] });
    expect(refunds).toEqual([]);
  });

  it("refunds the quota when the AI is stubbed, answers badly, or no reason rests on the facts", async () => {
    answer = { stubbed: true, data: null };
    expect(await ratePartners(a())).toMatchObject({ ok: false, error: expect.stringMatching(/stub mode/) });
    answer = { stubbed: false, data: null };
    expect((await ratePartners(a())).ok).toBe(false);
    answer = { stubbed: false, data: { rated: [{ partnerId: ids.Alpha!, reason: "Won $99M.", facts: [1] }] } };
    expect(await ratePartners(a())).toMatchObject({ ok: false, error: expect.stringMatching(/didn't rest on/) });
    expect(refunds).toHaveLength(3);
  });

  it("needs answered partners, and never rates another tenant's opportunity", async () => {
    await db.delete(opportunityPartners).where(eq(opportunityPartners.organizationId, fx.orgA.organizationId));
    expect(await ratePartners(a())).toEqual({ ok: false, error: "No partner has answered the questions yet." });
    const res = await ratePartners({ ...a(), opportunityId: fx.orgB.opportunityId });
    expect(res).toEqual({ ok: false, error: "Opportunity not found." });
    expect(prompts).toHaveLength(0);
    expect(refunds).toHaveLength(2);
  });
});
