import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { opportunities, opportunityActivities, opportunityDecisions, opportunityMilestones, opportunityPlans } from "@/db/schema";
import { latestDecisions } from "@/lib/opportunity-decision-store";
import { freezePlan, loadDevelopView, moveToDevelop, noteFrozenChange, unfreezePlan } from "@/lib/plan-freeze-store";
import { addPlanRole, loadPlan, plannedRoundsForProposal, setPlanRaci } from "@/lib/plan-store";
import { saveCharter, setAgreement, signCharter } from "@/lib/plan-charter-store";
import { RACI_AREAS } from "@/lib/plan-logic";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

/** BL-NAV-LIFECYCLE 4c-2 — the freeze, the Activity it writes, Move to Develop and the colour team's planned round: tenant-scoped and audited. */
describe("BL-NAV-LIFECYCLE 4c-2 — freeze, Move to Develop, planned round", () => {
  let fx: TwoTenantFixture;
  const org = () => fx.orgA.organizationId;
  const opp = () => fx.orgA.opportunityId;
  const actor = () => ({ userId: fx.orgA.userId, email: "a@bl19-isolation.test", name: "Ana Owner" });
  const activity = (opportunityId: string) =>
    db.select({ title: opportunityActivities.title, body: opportunityActivities.body }).from(opportunityActivities).where(eq(opportunityActivities.opportunityId, opportunityId)).orderBy(desc(opportunityActivities.createdAt));

  async function completePlan() {
    await loadPlan({ organizationId: org(), opportunityId: opp(), actor: actor() });
    const added = await addPlanRole({ organizationId: org(), opportunityId: opp(), userId: fx.orgA.userId, role: "proposal_manager", colorTeam: null, notes: "", actor: actor() });
    for (const area of RACI_AREAS) await setPlanRaci({ organizationId: org(), opportunityId: opp(), roleId: added.ok ? added.id! : "", area, letter: "A", actor: actor() });
    await saveCharter({ organizationId: org(), opportunityId: opp(), charter: { strategy: "Win.", pricingPosture: "Fixed.", winThemes: [{ title: "Proven", statement: "x" }] }, actor: actor() });
    await signCharter({ organizationId: org(), opportunityId: opp(), actor: actor() });
    const [plan] = await db.select({ id: opportunityPlans.id }).from(opportunityPlans).where(eq(opportunityPlans.opportunityId, opp()));
    await db.insert(opportunityMilestones).values({ organizationId: org(), opportunityId: opp(), planId: plan.id, title: "Submit", kind: "submit", date: "2026-12-20" });
    await db.update(opportunities).set({ stage: "capture" }).where(eq(opportunities.id, opp()));
  }

  beforeEach(async () => {
    fx = await createTwoTenants("plan-freeze");
  });
  afterEach(async () => {
    await fx.cleanup();
  });

  it("writes a change to the Activity only after the freeze, and not after an unfreeze", async () => {
    await loadPlan({ organizationId: org(), opportunityId: opp(), actor: actor() });
    const change = { area: "matrix", action: "added", label: "L.3 Staffing" } as const;
    await noteFrozenChange({ organizationId: org(), proposalId: fx.orgA.proposalId, userId: actor().userId, change });
    expect((await activity(opp())).some((a) => a.title.includes("after the freeze"))).toBe(false);

    expect((await freezePlan({ organizationId: org(), opportunityId: opp(), actor: actor() })).ok).toBe(true);
    await noteFrozenChange({ organizationId: org(), proposalId: fx.orgA.proposalId, userId: actor().userId, change });
    await noteFrozenChange({ organizationId: org(), proposalId: fx.orgA.proposalId, userId: actor().userId, change: { area: "outline", action: "removed", label: "Volume II" } });
    const rows = await activity(opp());
    expect(rows.map((r) => r.title)).toEqual(expect.arrayContaining(["Plan frozen", "Compliance matrix changed after the freeze", "Outline changed after the freeze"]));

    await unfreezePlan({ organizationId: org(), opportunityId: opp(), actor: actor() });
    const before = (await activity(opp())).length;
    await noteFrozenChange({ organizationId: org(), proposalId: fx.orgA.proposalId, userId: actor().userId, change });
    expect((await activity(opp())).length).toBe(before);
  });

  it("never writes to, or freezes, another tenant's opportunity", async () => {
    await loadPlan({ organizationId: org(), opportunityId: opp(), actor: actor() });
    await freezePlan({ organizationId: org(), opportunityId: opp(), actor: actor() });
    // Tenant B names tenant A's proposal and opportunity: nothing is written, nothing is stamped.
    await noteFrozenChange({ organizationId: fx.orgB.organizationId, proposalId: fx.orgA.proposalId, userId: fx.orgB.userId, change: { area: "matrix", action: "added", label: "x" } });
    expect((await activity(opp())).filter((a) => a.title.includes("after the freeze"))).toHaveLength(0);
    expect(await freezePlan({ organizationId: fx.orgB.organizationId, opportunityId: opp(), actor: { userId: fx.orgB.userId } })).toEqual({ ok: false, error: "Opportunity not found." });
    expect(await unfreezePlan({ organizationId: fx.orgB.organizationId, opportunityId: opp(), actor: { userId: fx.orgB.userId } })).toEqual({ ok: false, error: "Opportunity not found." });
    expect(await moveToDevelop({ organizationId: fx.orgB.organizationId, opportunityId: opp(), actor: { userId: fx.orgB.userId } })).toEqual({ ok: false, error: "Opportunity not found." });
    expect(await loadDevelopView({ organizationId: fx.orgB.organizationId, opportunityId: opp(), actor: { userId: fx.orgB.userId } })).toBeNull();
  });

  it("refuses Move to Develop with the blockers, then moves a complete plan: a plan decision, the stage, the Activity", async () => {
    await loadPlan({ organizationId: org(), opportunityId: opp(), actor: actor() });
    await db.update(opportunities).set({ stage: "capture" }).where(eq(opportunities.id, opp()));
    const refused = await moveToDevelop({ organizationId: org(), opportunityId: opp(), actor: actor() });
    expect(refused.ok).toBe(false);
    expect((await loadDevelopView({ organizationId: org(), opportunityId: opp(), actor: actor() }))!.blockers.length).toBeGreaterThan(3);

    await completePlan();
    expect((await loadDevelopView({ organizationId: org(), opportunityId: opp(), actor: actor() }))!.blockers).toEqual(["Freeze the compliance matrix.", "Freeze the outline."]);
    await freezePlan({ organizationId: org(), opportunityId: opp(), actor: actor() });
    expect((await loadDevelopView({ organizationId: org(), opportunityId: opp(), actor: actor() }))!.blockers).toEqual([]);

    expect(await moveToDevelop({ organizationId: org(), opportunityId: opp(), actor: actor() })).toEqual({ ok: true });
    const [o] = await db.select({ stage: opportunities.stage }).from(opportunities).where(eq(opportunities.id, opp()));
    expect(o.stage).toBe("pre_proposal");
    const decisions = await db.select({ decision: opportunityDecisions.decision }).from(opportunityDecisions).where(and(eq(opportunityDecisions.organizationId, org()), eq(opportunityDecisions.opportunityId, opp())));
    expect(decisions.map((d) => d.decision)).toEqual(["plan"]);
    // The plan decision is history, not the Evaluate call.
    expect((await latestDecisions(org(), [opp()])).get(opp())).toBeUndefined();
    expect((await activity(opp())).some((a) => a.title.includes("→") && a.body.startsWith("Moved to Develop"))).toBe(true);
    // Already in Develop: it cannot move again.
    expect((await moveToDevelop({ organizationId: org(), opportunityId: opp(), actor: actor() })).ok).toBe(false);
  });

  it("holds a PARTNER bid in Plan until the agreement is signed", async () => {
    await completePlan();
    await db.insert(opportunityDecisions).values({ organizationId: org(), opportunityId: opp(), decision: "partner", reasonCategory: "", reason: "", decidedByUserId: fx.orgA.userId });
    await freezePlan({ organizationId: org(), opportunityId: opp(), actor: actor() });
    expect((await moveToDevelop({ organizationId: org(), opportunityId: opp(), actor: actor() }))).toEqual({ ok: false, error: "Record the teaming agreement as signed." });
    await setAgreement({ organizationId: org(), opportunityId: opp(), status: "signed", date: "2026-11-09", actor: actor() });
    expect(await moveToDevelop({ organizationId: org(), opportunityId: opp(), actor: actor() })).toEqual({ ok: true });
    // The PARTNER call is still the latest Evaluate decision after the plan decision.
    expect((await latestDecisions(org(), [opp()])).get(opp())?.decision).toBe("partner");
  });

  it("plans a colour team's round from its reviewers and milestone, for its own tenant only", async () => {
    await loadPlan({ organizationId: org(), opportunityId: opp(), actor: actor() });
    await addPlanRole({ organizationId: org(), opportunityId: opp(), userId: fx.orgA.userId, role: "color_team_reviewer", colorTeam: "red", notes: "", actor: actor() });
    const [plan] = await db.select({ id: opportunityPlans.id }).from(opportunityPlans).where(eq(opportunityPlans.opportunityId, opp()));
    await db.insert(opportunityMilestones).values({ organizationId: org(), opportunityId: opp(), planId: plan.id, title: "Red team", kind: "red_team", date: "2026-12-05" });
    const planned = await plannedRoundsForProposal(org(), fx.orgA.proposalId);
    expect(planned.red).toEqual({ reviewerUserIds: [fx.orgA.userId], dueDate: "2026-12-05" });
    expect(planned.pink).toEqual({ reviewerUserIds: [], dueDate: null });
    const other = await plannedRoundsForProposal(fx.orgB.organizationId, fx.orgA.proposalId);
    expect(other.red).toEqual({ reviewerUserIds: [], dueDate: null });
  });
});
