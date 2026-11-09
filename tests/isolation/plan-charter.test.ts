import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, memberships, proposals, users } from "@/db/schema";
import { loadCharterPanel, reopenCharter, saveBudgetAndCutoffs, saveCharter, saveRisks, setAgreement, setAgreementFile, signCharter, agreementFileOf } from "@/lib/plan-charter-store";
import { loadPlan, planSummaries } from "@/lib/plan-store";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

/** BL-NAV-LIFECYCLE 4c-1 — the charter, its sign-off, the agreement, budget and risks: audited, and tenant-scoped. */
describe("BL-NAV-LIFECYCLE 4c-1 — the charter, agreement, budget and risks", () => {
  let fx: TwoTenantFixture;
  let outsider: string;
  const tag = () => `pc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const org = () => fx.orgA.organizationId;
  const opp = () => fx.orgA.opportunityId;
  const actorA = () => ({ userId: fx.orgA.userId, email: "a@bl19-isolation.test", name: "Ana Owner" });
  const words = { strategy: "Win on past performance.", pricingPosture: "Fixed price.", winThemes: [{ title: "Proven", statement: "We have done it." }] };

  beforeEach(async () => {
    fx = await createTwoTenants("plan-charter");
    outsider = `out-${tag()}`;
    await db.insert(users).values({ id: outsider, name: "Other Org", email: `${outsider}@bl19-isolation.test` });
    await db.insert(memberships).values({ userId: outsider, organizationId: fx.orgB.organizationId, role: "proposal", status: "active" });
    await loadPlan({ organizationId: org(), opportunityId: opp(), actor: actorA() });
    await loadPlan({ organizationId: fx.orgB.organizationId, opportunityId: fx.orgB.opportunityId, actor: { userId: fx.orgB.userId } });
  });

  afterEach(async () => {
    await fx.cleanup();
    await db.delete(users).where(eq(users.id, outsider));
  });

  it("will not sign an empty charter; signs a complete one, writes its themes to the proposal, and the plan's state reads signed", async () => {
    expect((await signCharter({ organizationId: org(), opportunityId: opp(), actor: actorA() })).ok).toBe(false);
    expect(await saveCharter({ organizationId: org(), opportunityId: opp(), charter: words, actor: actorA() })).toEqual({ ok: true, unsigned: false });
    expect((await planSummaries(org(), [opp()])).get(opp())!.charter).toBe("draft");
    expect(await signCharter({ organizationId: org(), opportunityId: opp(), actor: actorA() })).toMatchObject({ ok: true, wroteThemes: 1 });
    expect((await planSummaries(org(), [opp()])).get(opp())!.charter).toBe("signed");
    const view = await loadCharterPanel({ organizationId: org(), opportunityId: opp() });
    expect(view).toMatchObject({ status: "signed", signedByName: expect.any(String), isPartner: false });
    const [p] = await db.select({ themes: proposals.winThemes }).from(proposals).where(eq(proposals.id, fx.orgA.proposalId));
    expect(p.themes).toEqual([{ title: "Proven", statement: "We have done it." }]);
    expect((await signCharter({ organizationId: org(), opportunityId: opp(), actor: actorA() })).ok).toBe(false);
  });

  it("withdraws the sign-off when the words change, not when they do not; reopen clears it too", async () => {
    await saveCharter({ organizationId: org(), opportunityId: opp(), charter: words, actor: actorA() });
    await signCharter({ organizationId: org(), opportunityId: opp(), actor: actorA() });
    expect(await saveCharter({ organizationId: org(), opportunityId: opp(), charter: words, actor: actorA() })).toEqual({ ok: true, unsigned: false });
    expect((await loadCharterPanel({ organizationId: org(), opportunityId: opp() }))!.status).toBe("signed");
    expect(await saveCharter({ organizationId: org(), opportunityId: opp(), charter: { ...words, strategy: "A new plan." }, actor: actorA() })).toEqual({ ok: true, unsigned: true });
    expect((await loadCharterPanel({ organizationId: org(), opportunityId: opp() }))!.status).toBe("draft");
    await signCharter({ organizationId: org(), opportunityId: opp(), actor: actorA() });
    expect((await reopenCharter({ organizationId: org(), opportunityId: opp(), actor: actorA() })).ok).toBe(true);
    expect((await reopenCharter({ organizationId: org(), opportunityId: opp(), actor: actorA() })).ok).toBe(false);
  });

  it("records the agreement, its file, the budget with cut-offs, and the risks (an owner from another tenant is dropped), each audited", async () => {
    expect((await setAgreement({ organizationId: org(), opportunityId: opp(), status: "signed", date: null, actor: actorA() })).ok).toBe(false);
    expect((await setAgreement({ organizationId: org(), opportunityId: opp(), status: "signed", date: "2026-11-09", actor: actorA() })).ok).toBe(true);
    expect(await setAgreementFile({ organizationId: org(), opportunityId: opp(), fileName: "teaming.pdf", storageKey: "k/teaming.pdf", size: 10, actor: actorA() })).toEqual({ ok: true, replacedKey: "" });
    expect(await agreementFileOf(org(), opp())).toEqual({ storageKey: "k/teaming.pdf", fileName: "teaming.pdf" });
    expect(await agreementFileOf(fx.orgB.organizationId, opp())).toBeNull();

    expect((await saveBudgetAndCutoffs({ organizationId: org(), opportunityId: opp(), hours: "x", dollars: "", qaCutoff: null, amendmentCutoff: null, actor: actorA() })).ok).toBe(false);
    expect((await saveBudgetAndCutoffs({ organizationId: org(), opportunityId: opp(), hours: "800", dollars: "$120,000", qaCutoff: "2026-12-01", amendmentCutoff: null, actor: actorA() })).ok).toBe(true);
    const members = new Set([fx.orgA.userId]);
    expect((await saveRisks({ organizationId: org(), opportunityId: opp(), risks: [{ title: "Key person leaves", likelihood: "high", impact: "high", ownerUserId: fx.orgA.userId }, { title: "Foreign owner", ownerUserId: outsider }], memberIds: members, actor: actorA() })).ok).toBe(true);

    const view = (await loadCharterPanel({ organizationId: org(), opportunityId: opp() }))!;
    expect(view.agreement).toMatchObject({ status: "signed", date: "2026-11-09", fileName: "teaming.pdf", hasFile: true });
    expect(view.budget).toEqual({ hours: 800, dollars: 120000 });
    expect(view.cutoffs.qa).toMatchObject({ own: "2026-12-01", date: "2026-12-01", fromKeyDate: false });
    expect(view.risks.map((r) => [r.title, r.ownerUserId])).toEqual([["Key person leaves", fx.orgA.userId], ["Foreign owner", null]]);

    const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(and(eq(auditLogs.organizationId, org()), eq(auditLogs.resourceId, opp())));
    const actions = audits.map((a) => a.action);
    for (const a of ["opportunity.plan.agreement", "opportunity.plan.agreement.file", "opportunity.plan.budget", "opportunity.plan.risks"]) expect(actions).toContain(a);
  });

  it("keeps the other tenant's plan out of reach", async () => {
    const b = { organizationId: fx.orgB.organizationId, opportunityId: opp() };
    expect(await loadCharterPanel(b)).toBeNull();
    expect((await saveCharter({ ...b, charter: words, actor: { userId: fx.orgB.userId } })).ok).toBe(false);
    expect((await signCharter({ ...b, actor: { userId: fx.orgB.userId } })).ok).toBe(false);
    expect((await setAgreement({ ...b, status: "todo", date: null, actor: { userId: fx.orgB.userId } })).ok).toBe(false);
    expect((await loadCharterPanel({ organizationId: org(), opportunityId: opp() }))!.status).toBe("none");
  });
});
