/**
 * BL-NAV-LIFECYCLE 3c — partner invites against Postgres, two tenants: an
 * invite issues a personal link (only its hash stored) and marks the
 * partner invited; the link opens the questions without our answers or
 * references, takes the partner's answers and certifications, and marks
 * it answered on submit; a re-invite replaces the old link; an expired or
 * wrong link opens nothing; nothing crosses tenants.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, companies, opportunityCapabilityMatrices, opportunityPartnerInvites, opportunityPartners } from "@/db/schema";
import { addPartnerCandidate, listOpportunityPartners } from "@/lib/capture-store";
import { invitePartner, listPartnerInvites, loadPartnerMatrixByToken, savePartnerAnswersByToken } from "@/lib/partner-invite-store";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const sent: unknown[] = [];
vi.mock("@/lib/email", () => ({
  emailConfigured: () => true,
  sendPartnerInviteEmail: vi.fn(async (opts: unknown) => {
    sent.push(opts);
  }),
}));

describe("BL-NAV-LIFECYCLE 3c — partner invites", () => {
  let fx: TwoTenantFixture;
  let partnerId: string;

  beforeEach(async () => {
    sent.length = 0;
    fx = await createTwoTenants("partner-invite");
    const [co] = await db
      .insert(companies)
      .values({ organizationId: fx.orgA.organizationId, name: "Alpha Partner", relationship: "teaming_partner", email: "pat@alpha.example", contactName: "Pat" })
      .returning({ id: companies.id });
    const added = await addPartnerCandidate({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, companyId: co!.id, actor: { userId: fx.orgA.userId } });
    partnerId = added.ok ? added.id : "";
    await db.insert(opportunityCapabilityMatrices).values({
      organizationId: fx.orgA.organizationId,
      opportunityId: fx.orgA.opportunityId,
      questions: [
        { id: "q1", text: "Operate a 24x7 SOC", refs: ["L.4.2"], kind: "shall", area: "Security" },
        { id: "q2", text: "Cleared staff", refs: [], kind: "should", area: "Staffing" },
      ],
      answers: { q1: { value: "gap_partner", evidence: "our secret gap", partnerCompanyId: null, updatedAt: "", updatedByUserId: fx.orgA.userId } },
      suggestions: {},
    });
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  const a = () => ({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, actor: { userId: fx.orgA.userId, email: "me@a.example" } });
  const token = (link: string) => decodeURIComponent(link.split("/partner/")[1]!);

  it("invites by a personal link, emails it, stores only the hash, and the partner opens the questions without our answers", async () => {
    expect(await invitePartner({ ...a(), partnerId, email: "nope" })).toEqual({ ok: false, error: "Enter the contact's email address." });
    const res = await invitePartner({ ...a(), partnerId, email: "Pat@Alpha.example", contactName: "Pat" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.emailed).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "pat@alpha.example", url: res.link, days: 14 });
    const raw = token(res.link);
    const [row] = await db.select().from(opportunityPartnerInvites).where(eq(opportunityPartnerInvites.partnerId, partnerId));
    expect(row!.tokenHash).not.toBe(raw);
    expect(row!.emailedAt).not.toBeNull();
    expect((await listOpportunityPartners(fx.orgA.organizationId, fx.orgA.opportunityId))[0]).toMatchObject({ status: "invited", answerCount: 0 });
    expect((await listPartnerInvites(fx.orgA.organizationId, fx.orgA.opportunityId)).get(partnerId)).toMatchObject({ email: "pat@alpha.example", state: "open", emailed: true });
    expect((await listPartnerInvites(fx.orgB.organizationId, fx.orgA.opportunityId)).size).toBe(0);

    const opened = await loadPartnerMatrixByToken(raw);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.view).toMatchObject({ state: "open", companyName: "Alpha Partner", answers: {}, certifications: {} });
    expect(opened.view.questions).toEqual([
      { id: "q1", text: "Operate a 24x7 SOC", kind: "shall", area: "Security" },
      { id: "q2", text: "Cleared staff", kind: "should", area: "Staffing" },
    ]);
    expect(JSON.stringify(opened.view)).not.toMatch(/secret gap|L\.4\.2|gap_partner/);
    expect(await loadPartnerMatrixByToken(raw.slice(0, -1) + "x")).toMatchObject({ ok: false });
    const audits = await db.select({ action: auditLogs.action, actorEmail: auditLogs.actorEmailSnapshot }).from(auditLogs).where(eq(auditLogs.organizationId, fx.orgA.organizationId));
    expect(audits).toEqual(expect.arrayContaining([expect.objectContaining({ action: "opportunity.partner.invite" }), expect.objectContaining({ action: "opportunity.partner.invite.open", actorEmail: "pat@alpha.example" })]));
  });

  it("saves a draft, submits (partner answered), keeps editing until expiry, and a re-invite replaces the old link", async () => {
    const first = await invitePartner({ ...a(), partnerId, email: "pat@alpha.example" });
    if (!first.ok) throw new Error(first.error);
    const raw = token(first.link);
    const draft = await savePartnerAnswersByToken({ token: raw, answers: { q1: { answer: "partial", percent: 60, evidence: "SOC in Reston" }, zz: { answer: "yes" } }, certifications: { iso: ["ISO 27001"], cmmcLevel: 2 }, submit: false });
    expect(draft).toEqual({ ok: true, state: "open" });
    expect((await listOpportunityPartners(fx.orgA.organizationId, fx.orgA.opportunityId))[0]).toMatchObject({ status: "invited", answerCount: 1, certifications: ["ISO 27001", "CMMC L2"], answeredAt: null });
    const submitted = await savePartnerAnswersByToken({ token: raw, answers: { q1: { answer: "yes", evidence: "SOC in Reston" }, q2: { answer: "no", evidence: "" } }, certifications: {}, submit: true });
    expect(submitted).toEqual({ ok: true, state: "submitted" });
    const [p] = await listOpportunityPartners(fx.orgA.organizationId, fx.orgA.opportunityId);
    expect(p).toMatchObject({ status: "answered", answerCount: 2, certifications: [] });
    expect(p!.answeredAt).not.toBeNull();
    expect((await loadPartnerMatrixByToken(raw))).toMatchObject({ ok: true, view: { state: "submitted", answers: { q1: { answer: "yes", percent: null } } } });

    const again = await invitePartner({ ...a(), partnerId, email: "pat@alpha.example" });
    if (!again.ok) throw new Error(again.error);
    expect(await loadPartnerMatrixByToken(raw)).toMatchObject({ ok: true }); // the submitted link stays
    expect((await db.select().from(opportunityPartnerInvites).where(eq(opportunityPartnerInvites.partnerId, partnerId))).length).toBe(2);
    const third = await invitePartner({ ...a(), partnerId, email: "pat@alpha.example" });
    if (!third.ok) throw new Error(third.error);
    expect(await loadPartnerMatrixByToken(token(again.link))).toMatchObject({ ok: false }); // the unanswered one is replaced
    expect((await listOpportunityPartners(fx.orgA.organizationId, fx.orgA.opportunityId))[0]!.status).toBe("answered");

    await db.update(opportunityPartnerInvites).set({ expiresAt: new Date(Date.now() - 1_000) }).where(eq(opportunityPartnerInvites.partnerId, partnerId));
    expect(await loadPartnerMatrixByToken(token(third.link))).toMatchObject({ ok: false, error: expect.stringContaining("expired") });
    expect(await savePartnerAnswersByToken({ token: token(third.link), answers: {}, certifications: {}, submit: true })).toMatchObject({ ok: false });
  });

  it("needs the questions built, and never reaches another tenant's partner", async () => {
    await db.delete(opportunityCapabilityMatrices).where(eq(opportunityCapabilityMatrices.opportunityId, fx.orgA.opportunityId));
    expect(await invitePartner({ ...a(), partnerId, email: "pat@alpha.example" })).toMatchObject({ ok: false, error: expect.stringContaining("Build the capability questions") });
    expect(await invitePartner({ ...a(), organizationId: fx.orgB.organizationId, opportunityId: fx.orgB.opportunityId, partnerId, email: "pat@alpha.example" })).toEqual({ ok: false, error: "Partner not found on this opportunity." });
    expect((await db.select().from(opportunityPartners).where(eq(opportunityPartners.id, partnerId)))[0]!.status).toBe("candidate");
  });
});
