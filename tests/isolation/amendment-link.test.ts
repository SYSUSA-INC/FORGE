/**
 * BL-AIX Phase 0d — an amendment belongs to its parent's opportunity, so
 * its requirements reach the shared loader, the matrix seed, the drafter
 * and Q&A flagging. Converting a parent carries amendments uploaded
 * before the conversion; another workspace can't convert or link.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { solicitations } from "@/db/schema";
import { loadOpportunityRequirements } from "@/lib/solicitation-requirements";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const sessionUserStub = {
  id: "PLACEHOLDER",
  email: "capture@amend.test",
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

import { convertToOpportunityAction } from "@/app/(app)/solicitations/actions";

describe("BL-AIX Phase 0d — amendments follow their parent's opportunity", () => {
  let fx: TwoTenantFixture;
  let parentId = "";
  let amendmentId = "";

  const actAs = (org: TwoTenantFixture["orgA"]) => {
    sessionUserStub.id = org.userId;
    sessionUserStub.organizationId = org.organizationId;
  };

  beforeEach(async () => {
    fx = await createTwoTenants("amendlink");
    const [parent] = await db
      .insert(solicitations)
      .values({
        organizationId: fx.orgA.organizationId,
        title: "Base RFP",
        parseStatus: "parsed",
        extractedRequirements: [{ kind: "shall", ref: "L.1", text: "Submit three volumes." }],
      })
      .returning({ id: solicitations.id });
    parentId = parent!.id;
    const [amendment] = await db
      .insert(solicitations)
      .values({
        organizationId: fx.orgA.organizationId,
        title: "Amendment 0001",
        parseStatus: "parsed",
        parentSolicitationId: parentId,
        amendmentNumber: "0001",
        extractedRequirements: [{ kind: "shall", ref: "L.2", text: "The Technical Volume shall not exceed 25 pages." }],
      })
      .returning({ id: solicitations.id });
    amendmentId = amendment!.id;
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("converting the parent links its amendments, and their requirements load with the opportunity", async () => {
    actAs(fx.orgB);
    expect(await convertToOpportunityAction(parentId)).toEqual({ ok: false, error: "Solicitation not found." });

    actAs(fx.orgA);
    const res = await convertToOpportunityAction(parentId);
    if (!res.ok) throw new Error(res.error);
    const [row] = await db
      .select({ opportunityId: solicitations.opportunityId })
      .from(solicitations)
      .where(and(eq(solicitations.id, amendmentId), eq(solicitations.organizationId, fx.orgA.organizationId)));
    expect(row!.opportunityId).toBe(res.opportunityId);

    const loaded = await loadOpportunityRequirements({ organizationId: fx.orgA.organizationId, opportunityId: res.opportunityId });
    expect(loaded.requirements.map((r) => r.text)).toEqual(
      expect.arrayContaining(["Submit three volumes.", "The Technical Volume shall not exceed 25 pages."]),
    );
  });
});
