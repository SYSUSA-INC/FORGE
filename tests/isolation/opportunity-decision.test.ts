/**
 * BL-NAV-LIFECYCLE phase 2a — the Evaluate decision against Postgres, two
 * tenants. A decision is kept as its own row with the PWin and capability
 * coverage of the moment; GO and PARTNER move the opportunity to Capture,
 * NO-GO (which needs a category and a reason) closes it as No bid; a
 * changed decision is a second row, the history newest first; every
 * decision is audited and noted on the opportunity. Another tenant's
 * opportunity is refused and left as it was. Partner suggestions are the
 * company's own teaming partners and subcontractors, same-NAICS first,
 * never another tenant's. The Evaluate list's signals read the brief,
 * the matrix and the latest decision.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { aiBriefs, auditLogs, companies, opportunities, opportunityActivities, opportunityCapabilityMatrices, opportunityDecisions } from "@/db/schema";
import { decisionHistory, evaluateSignals, partnerSuggestions, recordDecision } from "@/lib/opportunity-decision-store";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const answer = (value: "have_proven" | "gap_partner") => ({ value, evidence: "", partnerCompanyId: null, updatedAt: "2026-11-06T00:00:00Z", updatedByUserId: "" });

describe("BL-NAV-LIFECYCLE 2a — the Evaluate decision", () => {
  let fx: TwoTenantFixture;

  beforeEach(async () => {
    fx = await createTwoTenants("evaluate-decision");
    for (const t of [fx.orgA, fx.orgB]) {
      await db.update(opportunities).set({ stage: "identified", pWin: 42, naicsCode: "541512 - Computer Systems Design" }).where(eq(opportunities.id, t.opportunityId));
    }
    await db.insert(opportunityCapabilityMatrices).values({
      organizationId: fx.orgA.organizationId,
      opportunityId: fx.orgA.opportunityId,
      questions: [
        { id: "q1", text: "Help desk", refs: ["C.1"], kind: "shall", area: "Service" },
        { id: "q2", text: "Cleared SOC", refs: ["C.2"], kind: "shall", area: "Security" },
      ],
      answers: { q1: answer("have_proven"), q2: answer("gap_partner") },
    });
    await db.insert(companies).values([
      { organizationId: fx.orgA.organizationId, name: "Alpha Partner", relationship: "teaming_partner", primaryNaics: "541519", naicsList: ["541512"] },
      { organizationId: fx.orgA.organizationId, name: "Beta Sub", relationship: "subcontractor", primaryNaics: "561210", naicsList: [] },
      { organizationId: fx.orgA.organizationId, name: "Gamma Watch", relationship: "watchlist", primaryNaics: "541512", naicsList: [] },
      { organizationId: fx.orgB.organizationId, name: "Other Tenant Partner", relationship: "teaming_partner", primaryNaics: "541512", naicsList: [] },
    ]);
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  const stageOf = async (id: string) => (await db.select({ stage: opportunities.stage }).from(opportunities).where(eq(opportunities.id, id)))[0]?.stage;
  const actor = () => ({ userId: fx.orgA.userId, email: null });

  it("keeps a PARTNER with its PWin and coverage, moves it to Capture, notes and audits it", async () => {
    const res = await recordDecision({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, actor: actor(), decision: { decision: "partner", reason: "Need a cleared SOC" } });
    expect(res).toEqual({ ok: true, decision: "partner" });
    expect(await stageOf(fx.orgA.opportunityId)).toBe("qualification");
    const rows = await db.select().from(opportunityDecisions).where(eq(opportunityDecisions.opportunityId, fx.orgA.opportunityId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ organizationId: fx.orgA.organizationId, decision: "partner", pwin: 42, decidedByUserId: fx.orgA.userId, reason: "Need a cleared SOC" });
    expect(rows[0]!.coverage).toBeCloseTo(0.5, 5);
    const audits = await db.select().from(auditLogs).where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "opportunity.decision")));
    expect(audits).toHaveLength(1);
    const notes = await db.select({ body: opportunityActivities.body, title: opportunityActivities.title }).from(opportunityActivities).where(eq(opportunityActivities.opportunityId, fx.orgA.opportunityId));
    expect(notes.some((n) => `${n.title} ${n.body}`.includes("Decision: PARTNER."))).toBe(true);
  });

  it("refuses a NO-GO without its category and reason, then closes it with them; a changed decision is a new row", async () => {
    const opp = { organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, actor: actor() };
    expect((await recordDecision({ ...opp, decision: { decision: "no_go", reason: "The incumbent is too strong." } })).ok).toBe(false);
    expect((await recordDecision({ ...opp, decision: { decision: "no_go", category: "competition", reason: "too short" } })).ok).toBe(false);
    expect(await stageOf(fx.orgA.opportunityId)).toBe("identified");
    expect(await db.select().from(opportunityDecisions).where(eq(opportunityDecisions.opportunityId, fx.orgA.opportunityId))).toHaveLength(0);

    await recordDecision({ ...opp, decision: { decision: "go" } });
    await new Promise((r) => setTimeout(r, 5));
    const res = await recordDecision({ ...opp, decision: { decision: "no_go", category: "competition", reason: "The incumbent has held it for ten years." } });
    expect(res.ok).toBe(true);
    expect(await stageOf(fx.orgA.opportunityId)).toBe("no_bid");
    const history = await decisionHistory(fx.orgA.organizationId, fx.orgA.opportunityId);
    expect(history.map((h) => h.decision)).toEqual(["no_go", "go"]);
    expect(history[0]).toMatchObject({ category: "competition", reason: "The incumbent has held it for ten years." });
  });

  it("refuses another tenant's opportunity and leaves it as it was", async () => {
    const res = await recordDecision({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgB.opportunityId, actor: actor(), decision: { decision: "go" } });
    expect(res).toEqual({ ok: false, error: "Opportunity not found." });
    expect(await stageOf(fx.orgB.opportunityId)).toBe("identified");
    expect(await db.select().from(opportunityDecisions).where(eq(opportunityDecisions.opportunityId, fx.orgB.opportunityId))).toHaveLength(0);
    expect(await decisionHistory(fx.orgA.organizationId, fx.orgB.opportunityId)).toEqual([]);
  });

  it("suggests the company's own partners, same NAICS first, never another tenant's or a watchlist company", async () => {
    const list = await partnerSuggestions(fx.orgA.organizationId, fx.orgA.opportunityId);
    expect(list.map((p) => p.name)).toEqual(["Alpha Partner", "Beta Sub"]);
    expect(list[0]!.why).toBe("Your teaming partner; works under NAICS 541512");
    expect(list[1]!.why).toBe("Your subcontractor");
    expect(await partnerSuggestions(fx.orgA.organizationId, fx.orgB.opportunityId)).toEqual([]);
  });

  it("gives the Evaluate list each row's brief, matrix and latest decision, own tenant only", async () => {
    await db.insert(aiBriefs).values([
      { organizationId: fx.orgA.organizationId, kind: "pursuit", opportunityId: fx.orgA.opportunityId, recommendation: "watch", createdAt: new Date(Date.now() - 60_000) },
      { organizationId: fx.orgA.organizationId, kind: "pursuit", opportunityId: fx.orgA.opportunityId, recommendation: "pursue" },
      { organizationId: fx.orgB.organizationId, kind: "pursuit", opportunityId: fx.orgB.opportunityId, recommendation: "pursue" },
    ]);
    await recordDecision({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, actor: actor(), decision: { decision: "go" } });
    const sig = await evaluateSignals(fx.orgA.organizationId, [fx.orgA.opportunityId, fx.orgB.opportunityId]);
    expect(sig.get(fx.orgA.opportunityId)).toMatchObject({ call: "pursue", analysed: true, questions: 2, answered: 2, decision: { decision: "go" } });
    expect(sig.get(fx.orgB.opportunityId)).toEqual({ call: null, analysisPwin: null, analysed: false, questions: 0, answered: 0, coverage: null, decision: null });
  });
});
