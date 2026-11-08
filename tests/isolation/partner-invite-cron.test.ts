/**
 * BL-NAV-LIFECYCLE 3c-3 — the sweep of expired partner invites against
 * Postgres, two tenants: an expired link is retired (hash cleared, row
 * kept) and stops opening; a partner invited but never answered goes back
 * to candidate, one that answered stays answered, one re-invited since
 * keeps its new link; one audit row per affected partner, actor the
 * system; the other tenant's live invite is untouched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, companies, opportunityCapabilityMatrices, opportunityPartnerInvites, opportunityPartners } from "@/db/schema";
import { addPartnerCandidate } from "@/lib/capture-store";
import { sweepExpiredPartnerInvites } from "@/lib/partner-invite-cron";
import { invitePartner, listPartnerInvites, loadPartnerMatrixByToken, savePartnerAnswersByToken } from "@/lib/partner-invite-store";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

vi.mock("@/lib/email", () => ({ emailConfigured: () => false, sendPartnerInviteEmail: vi.fn() }));

const token = (link: string) => decodeURIComponent(link.split("/partner/")[1]!);
const DAY_MS = 86_400_000;

describe("BL-NAV-LIFECYCLE 3c-3 — the sweep of expired partner invites", () => {
  let fx: TwoTenantFixture;

  beforeEach(async () => {
    fx = await createTwoTenants("partner-invite-cron");
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  async function partnerWithMatrix(org: TwoTenantFixture["orgA"], name: string): Promise<string> {
    const [co] = await db.insert(companies).values({ organizationId: org.organizationId, name, relationship: "teaming_partner" }).returning({ id: companies.id });
    const added = await addPartnerCandidate({ organizationId: org.organizationId, opportunityId: org.opportunityId, companyId: co!.id, actor: { userId: org.userId } });
    await db.insert(opportunityCapabilityMatrices).values({
      organizationId: org.organizationId,
      opportunityId: org.opportunityId,
      questions: [{ id: "q1", text: "Operate a 24x7 SOC", refs: [], kind: "shall", area: "Security" }],
      answers: {},
      suggestions: {},
    });
    return added.ok ? added.id : "";
  }

  async function invite(org: TwoTenantFixture["orgA"], partnerId: string, email: string): Promise<string> {
    const res = await invitePartner({ organizationId: org.organizationId, opportunityId: org.opportunityId, partnerId, email, actor: { userId: org.userId } });
    if (!res.ok) throw new Error(res.error);
    return token(res.link);
  }

  async function expire(partnerId: string, daysAgo = 1) {
    await db
      .update(opportunityPartnerInvites)
      .set({ expiresAt: new Date(Date.now() - daysAgo * DAY_MS) })
      .where(eq(opportunityPartnerInvites.partnerId, partnerId));
  }

  it("retires expired links, reverts the unanswered partner only, audits per partner, and leaves the other tenant alone", async () => {
    const unanswered = await partnerWithMatrix(fx.orgA, "Never Answered");
    const [answeredCo] = await db.insert(companies).values({ organizationId: fx.orgA.organizationId, name: "Answered Co", relationship: "teaming_partner" }).returning({ id: companies.id });
    const answered = await addPartnerCandidate({ organizationId: fx.orgA.organizationId, opportunityId: fx.orgA.opportunityId, companyId: answeredCo!.id, actor: { userId: fx.orgA.userId } });
    const answeredId = answered.ok ? answered.id : "";
    const other = await partnerWithMatrix(fx.orgB, "Other Tenant");

    const t1 = await invite(fx.orgA, unanswered, "one@a.example");
    const t2 = await invite(fx.orgA, answeredId, "two@a.example");
    expect(await savePartnerAnswersByToken({ token: t2, answers: { q1: { answer: "yes", evidence: "" } }, certifications: {}, submit: true })).toEqual({ ok: true, state: "submitted" });
    const tB = await invite(fx.orgB, other, "b@b.example");

    // Nothing expired yet: nothing happens.
    expect(await sweepExpiredPartnerInvites()).toEqual({ expired: 0, cleared: 0, reverted: 0, organizations: 0, errors: 0 });

    await expire(unanswered);
    await expire(answeredId);
    await expire(other, -1); // B's link is still live.

    expect(await sweepExpiredPartnerInvites()).toEqual({ expired: 2, cleared: 2, reverted: 1, organizations: 1, errors: 0 });

    // The links are retired and no longer open; the rows stay, read as expired.
    expect(await loadPartnerMatrixByToken(t1)).toMatchObject({ ok: false, error: expect.stringContaining("not valid") });
    expect(await loadPartnerMatrixByToken(t2)).toMatchObject({ ok: false, error: expect.stringContaining("not valid") });
    const hashes = await db.select({ partnerId: opportunityPartnerInvites.partnerId, tokenHash: opportunityPartnerInvites.tokenHash }).from(opportunityPartnerInvites).where(eq(opportunityPartnerInvites.organizationId, fx.orgA.organizationId));
    expect(hashes.map((h) => h.tokenHash)).toEqual([null, null]);
    const views = await listPartnerInvites(fx.orgA.organizationId, fx.orgA.opportunityId);
    expect(views.get(unanswered)?.state).toBe("expired");
    expect(views.get(answeredId)?.state).toBe("expired");

    // The unanswered partner is a candidate again; the one that answered stays answered.
    const statuses = await db.select({ id: opportunityPartners.id, status: opportunityPartners.status }).from(opportunityPartners).where(eq(opportunityPartners.organizationId, fx.orgA.organizationId));
    expect(new Map(statuses.map((s) => [s.id, s.status]))).toEqual(new Map([[unanswered, "candidate"], [answeredId, "answered"]]));

    // One audit row per affected partner, actor the system.
    const audits = await db
      .select({ actorUserId: auditLogs.actorUserId, actorEmail: auditLogs.actorEmailSnapshot, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "opportunity.partner.invite.expire")));
    expect(audits).toHaveLength(2);
    expect(audits.every((r) => r.actorUserId === null && r.actorEmail === "system")).toBe(true);
    expect(audits.map((r) => r.metadata).sort((x, y) => String((x as { email: string }).email).localeCompare(String((y as { email: string }).email)))).toMatchObject([
      { partnerId: unanswered, email: "one@a.example", submitted: false, reverted: true },
      { partnerId: answeredId, email: "two@a.example", submitted: true, reverted: false },
    ]);

    // B's live invite still opens and its partner is still invited.
    expect(await loadPartnerMatrixByToken(tB)).toMatchObject({ ok: true });
    const [bPartner] = await db.select({ status: opportunityPartners.status }).from(opportunityPartners).where(eq(opportunityPartners.id, other));
    expect(bPartner?.status).toBe("invited");

    // A second run finds nothing left.
    expect(await sweepExpiredPartnerInvites()).toEqual({ expired: 0, cleared: 0, reverted: 0, organizations: 0, errors: 0 });
  });

  it("keeps a partner invited when it was re-invited after its first link expired", async () => {
    const partnerId = await partnerWithMatrix(fx.orgA, "Re-invited");
    const first = await invite(fx.orgA, partnerId, "p@a.example");
    // Age the first link, then re-invite: the re-invite replaces unanswered links, so age a submitted one instead.
    await savePartnerAnswersByToken({ token: first, answers: {}, certifications: {}, submit: true });
    await db.update(opportunityPartnerInvites).set({ expiresAt: new Date(Date.now() - DAY_MS) }).where(eq(opportunityPartnerInvites.partnerId, partnerId));
    await db.update(opportunityPartners).set({ status: "invited" }).where(eq(opportunityPartners.id, partnerId));
    const second = await invite(fx.orgA, partnerId, "p@a.example");

    expect(await sweepExpiredPartnerInvites()).toEqual({ expired: 1, cleared: 1, reverted: 0, organizations: 1, errors: 0 });
    expect(await loadPartnerMatrixByToken(first)).toMatchObject({ ok: false });
    expect(await loadPartnerMatrixByToken(second)).toMatchObject({ ok: true });
    const [p] = await db.select({ status: opportunityPartners.status }).from(opportunityPartners).where(eq(opportunityPartners.id, partnerId));
    expect(p?.status).toBe("invited");
  });
});
