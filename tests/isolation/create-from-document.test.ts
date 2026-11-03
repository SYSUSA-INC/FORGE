/**
 * BL-NAV-LIFECYCLE 1a — Create from a document: the opportunity is
 * created with its document linked from birth (amendments follow), the
 * audit says so, a document already linked is refused, and another
 * workspace's document can be neither read nor linked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, opportunities, solicitations } from "@/db/schema";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const sessionUserStub = {
  id: "PLACEHOLDER",
  email: "capture@create-doc.test",
  name: "Capture Lead",
  image: null as null,
  isSuperadmin: false as const,
  organizationId: "PLACEHOLDER",
  role: "admin" as const,
};

vi.mock("@/lib/auth-helpers", () => ({
  requireAuth: async () => sessionUserStub,
  requireCurrentOrg: async () => ({ user: sessionUserStub, organizationId: sessionUserStub.organizationId, isImpersonating: false }),
  requireOrgAdmin: async () => sessionUserStub,
  getSessionUser: async () => sessionUserStub,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { createOpportunityAction } from "@/app/(app)/opportunities/actions";

describe("BL-NAV-LIFECYCLE 1a — createOpportunityAction from a document", () => {
  let fx: TwoTenantFixture;
  let docA = "";
  let amendA = "";

  const actAs = (org: TwoTenantFixture["orgA"]) => {
    sessionUserStub.id = org.userId;
    sessionUserStub.organizationId = org.organizationId;
  };

  beforeEach(async () => {
    fx = await createTwoTenants("createdoc");
    const [doc] = await db
      .insert(solicitations)
      .values({ organizationId: fx.orgA.organizationId, title: "Base RFP", fileName: "rfp.pdf", parseStatus: "parsed" })
      .returning({ id: solicitations.id });
    docA = doc!.id;
    const [amend] = await db
      .insert(solicitations)
      .values({ organizationId: fx.orgA.organizationId, title: "Amendment 0001", parseStatus: "parsed", parentSolicitationId: docA })
      .returning({ id: solicitations.id });
    amendA = amend!.id;
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("creates the opportunity at Identified with the document and its amendments linked, audited as from a document", async () => {
    actAs(fx.orgA);
    const res = await createOpportunityAction({ title: "Help desk modernization", agency: "VA" }, { solicitationId: docA });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [opp] = await db.select({ stage: opportunities.stage }).from(opportunities).where(eq(opportunities.id, res.id));
    expect(opp?.stage).toBe("identified");
    const linked = await db
      .select({ id: solicitations.id, opportunityId: solicitations.opportunityId })
      .from(solicitations)
      .where(eq(solicitations.organizationId, fx.orgA.organizationId));
    expect(linked.find((r) => r.id === docA)?.opportunityId).toBe(res.id);
    expect(linked.find((r) => r.id === amendA)?.opportunityId).toBe(res.id);
    const [audit] = await db
      .select({ metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "opportunity.create"), eq(auditLogs.resourceId, res.id)));
    expect(audit?.metadata).toMatchObject({ from: "document", solicitationId: docA });
  });

  it("refuses a document that already belongs to an opportunity, creating nothing", async () => {
    actAs(fx.orgA);
    const first = await createOpportunityAction({ title: "First" }, { solicitationId: docA });
    expect(first.ok).toBe(true);
    const before = await db.select({ id: opportunities.id }).from(opportunities).where(eq(opportunities.organizationId, fx.orgA.organizationId));
    const second = await createOpportunityAction({ title: "Second" }, { solicitationId: docA });
    expect(second).toMatchObject({ ok: false });
    const after = await db.select({ id: opportunities.id }).from(opportunities).where(eq(opportunities.organizationId, fx.orgA.organizationId));
    expect(after.length).toBe(before.length);
  });

  it("another workspace can't create from, or link, this workspace's document", async () => {
    actAs(fx.orgB);
    const before = await db.select({ id: opportunities.id }).from(opportunities).where(eq(opportunities.organizationId, fx.orgB.organizationId));
    const res = await createOpportunityAction({ title: "Snoop" }, { solicitationId: docA });
    expect(res).toMatchObject({ ok: false });
    const [doc] = await db.select({ opportunityId: solicitations.opportunityId }).from(solicitations).where(eq(solicitations.id, docA));
    expect(doc?.opportunityId).toBeNull();
    const after = await db.select({ id: opportunities.id }).from(opportunities).where(eq(opportunities.organizationId, fx.orgB.organizationId));
    expect(after.length).toBe(before.length);
  });

  it("by hand, nothing is linked and the audit says so", async () => {
    actAs(fx.orgA);
    const res = await createOpportunityAction({ title: "A lead" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [audit] = await db
      .select({ metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.action, "opportunity.create"), eq(auditLogs.resourceId, res.id)));
    expect(audit?.metadata).toMatchObject({ from: "hand", solicitationId: null });
  });
});
