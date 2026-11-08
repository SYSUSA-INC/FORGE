/**
 * BL-NAV-LIFECYCLE 3a — Capture against Postgres, two tenants: a partner
 * is one of the organization's own companies on one of its own
 * opportunities; choosing one opens Move to Plan for a PARTNER, which
 * moves the opportunity to Captured with a note that the agreement is
 * still to do; a GO moves at once; every change is audited; nothing
 * crosses tenants.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, companies, opportunities, opportunityActivities, opportunityDecisions, opportunityPartners } from "@/db/schema";
import { addPartnerCandidate, companiesToConsider, listOpportunityPartners, moveToPlan, partnerSummaries, removePartner, setPartnerStatus } from "@/lib/capture-store";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

describe("BL-NAV-LIFECYCLE 3a — Capture", () => {
  let fx: TwoTenantFixture;
  let alpha: string;
  let beta: string;
  let theirs: string;

  beforeEach(async () => {
    fx = await createTwoTenants("capture");
    for (const t of [fx.orgA, fx.orgB]) await db.update(opportunities).set({ stage: "qualification" }).where(eq(opportunities.id, t.opportunityId));
    await db.insert(opportunityDecisions).values({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, decision: "partner", decidedByUserId: fx.orgA.userId });
    const rows = await db
      .insert(companies)
      .values([
        { organizationId: fx.orgA.organizationId, name: "Alpha Partner", relationship: "teaming_partner" },
        { organizationId: fx.orgA.organizationId, name: "Beta Sub", relationship: "subcontractor" },
        { organizationId: fx.orgB.organizationId, name: "Their Partner", relationship: "teaming_partner" },
      ])
      .returning({ id: companies.id });
    [alpha, beta, theirs] = rows.map((r) => r.id) as [string, string, string];
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  const actor = () => ({ userId: fx.orgA.userId, email: null });
  const a = () => ({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, actor: actor() });

  it("adds the organization's own companies only, once each", async () => {
    const first = await addPartnerCandidate({ ...a(), companyId: alpha, reason: "Covers the SOC" });
    expect(first.ok).toBe(true);
    const again = await addPartnerCandidate({ ...a(), companyId: alpha });
    expect(again).toEqual(first);
    expect(await addPartnerCandidate({ ...a(), companyId: theirs })).toEqual({ ok: false, error: "Company not found." });
    expect(await addPartnerCandidate({ ...a(), opportunityId: fx.orgB.opportunityId, companyId: alpha })).toEqual({ ok: false, error: "Opportunity not found." });
    expect((await listOpportunityPartners(fx.orgA.organizationId, fx.orgA.opportunityId)).map((p) => [p.name, p.status, p.reason])).toEqual([["Alpha Partner", "candidate", "Covers the SOC"]]);
    expect((await companiesToConsider(fx.orgA.organizationId, fx.orgA.opportunityId)).map((c) => c.name)).toEqual(["Beta Sub"]);
  });

  it("holds a PARTNER in Capture until a partner is chosen, then moves it to Plan with the agreement to do", async () => {
    const added = await addPartnerCandidate({ ...a(), companyId: alpha });
    expect(await moveToPlan(a())).toEqual({ ok: false, error: "Choose a partner first: this opportunity was decided PARTNER." });
    expect(await setPartnerStatus({ ...a(), partnerId: added.ok ? added.id : "", status: "chosen" })).toEqual({ ok: true });
    expect((await partnerSummaries(fx.orgA.organizationId, [fx.orgA.opportunityId])).get(fx.orgA.opportunityId)).toMatchObject({ chosen: ["Alpha Partner"], counts: { chosen: 1 } });
    expect(await moveToPlan(a())).toEqual({ ok: true });
    const [opp] = await db.select({ stage: opportunities.stage }).from(opportunities).where(eq(opportunities.id, fx.orgA.opportunityId));
    expect(opp!.stage).toBe("capture");
    const notes = await db.select({ body: opportunityActivities.body, title: opportunityActivities.title }).from(opportunityActivities).where(eq(opportunityActivities.opportunityId, fx.orgA.opportunityId));
    expect(notes.some((n) => `${n.title} ${n.body}`.includes("Teaming agreement: to do"))).toBe(true);
    const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.organizationId, fx.orgA.organizationId));
    expect(audits.map((x) => x.action)).toEqual(expect.arrayContaining(["opportunity.partner.add", "opportunity.partner.choose"]));
    // Already in Plan: no second move.
    expect((await moveToPlan(a())).ok).toBe(false);
  });

  it("moves a GO at once, and never touches another tenant", async () => {
    await db.insert(opportunityDecisions).values({ organizationId: fx.orgB.organizationId, opportunityId: fx.orgB.opportunityId, decision: "go", decidedByUserId: fx.orgB.userId });
    expect(await moveToPlan({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgB.opportunityId, actor: actor() })).toEqual({ ok: false, error: "Opportunity not found." });
    expect(await moveToPlan({ organizationId: fx.orgB.organizationId, opportunityId: fx.orgB.opportunityId, actor: { userId: fx.orgB.userId } })).toEqual({ ok: true });
    const added = await addPartnerCandidate({ ...a(), companyId: beta });
    expect(await setPartnerStatus({ organizationId: fx.orgB.organizationId, opportunityId: fx.orgA.opportunityId, partnerId: added.ok ? added.id : "", status: "chosen", actor: { userId: fx.orgB.userId } })).toEqual({ ok: false, error: "Partner not found." });
    expect(await removePartner({ organizationId: fx.orgB.organizationId, opportunityId: fx.orgA.opportunityId, partnerId: added.ok ? added.id : "", actor: { userId: fx.orgB.userId } })).toEqual({ ok: false, error: "Partner not found." });
    expect(await db.select().from(opportunityPartners).where(and(eq(opportunityPartners.opportunityId, fx.orgA.opportunityId)))).toHaveLength(1);
  });
});
