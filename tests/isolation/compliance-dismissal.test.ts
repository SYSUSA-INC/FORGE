/**
 * BL-AIX Phase 0d — a compliance row the team deletes stays deleted:
 * "Seed from solicitation" skips its text from then on. Another
 * workspace can't delete the row or see the dismissal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceItems, complianceSeedDismissals, solicitations } from "@/db/schema";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const sessionUserStub = {
  id: "PLACEHOLDER",
  email: "pm@dismiss.test",
  name: "Proposal Manager",
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

import { deleteComplianceItemAction, seedComplianceFromSolicitationAction } from "@/app/(app)/proposals/[id]/compliance/actions";

describe("BL-AIX Phase 0d — deleted matrix rows stay deleted", () => {
  let fx: TwoTenantFixture;

  const actAs = (org: TwoTenantFixture["orgA"]) => {
    sessionUserStub.id = org.userId;
    sessionUserStub.organizationId = org.organizationId;
  };

  beforeEach(async () => {
    fx = await createTwoTenants("dismiss");
    await db.insert(solicitations).values({
      organizationId: fx.orgA.organizationId,
      opportunityId: fx.orgA.opportunityId,
      title: "Dismissal RFP",
      parseStatus: "parsed",
      extractedRequirements: [
        { kind: "shall", ref: "L.1", text: "The offeror shall submit three volumes." },
        { kind: "shall", ref: "C.9", text: "The contractor shall paint the fence green." },
      ],
    });
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("a re-seed skips a requirement the team deleted, and only for that proposal", async () => {
    actAs(fx.orgA);
    const first = await seedComplianceFromSolicitationAction(fx.orgA.proposalId);
    expect(first).toMatchObject({ ok: true, inserted: 2, skippedDismissed: 0 });

    const [fence] = await db
      .select({ id: complianceItems.id })
      .from(complianceItems)
      .where(and(eq(complianceItems.proposalId, fx.orgA.proposalId), eq(complianceItems.requirementText, "The contractor shall paint the fence green.")));

    // Another workspace can't delete it.
    actAs(fx.orgB);
    expect(await deleteComplianceItemAction(fx.orgA.proposalId, fence!.id)).toEqual({ ok: false, error: "Proposal not found." });

    actAs(fx.orgA);
    expect(await deleteComplianceItemAction(fx.orgA.proposalId, fence!.id)).toEqual({ ok: true });
    const dismissals = await db
      .select({ key: complianceSeedDismissals.requirementKey })
      .from(complianceSeedDismissals)
      .where(and(eq(complianceSeedDismissals.organizationId, fx.orgA.organizationId), eq(complianceSeedDismissals.proposalId, fx.orgA.proposalId)));
    expect(dismissals).toEqual([{ key: "the contractor shall paint the fence green." }]);

    const again = await seedComplianceFromSolicitationAction(fx.orgA.proposalId);
    expect(again).toMatchObject({ ok: true, inserted: 0, skippedDismissed: 1, skippedDuplicates: 1 });
    const rows = await db.select({ text: complianceItems.requirementText }).from(complianceItems).where(eq(complianceItems.proposalId, fx.orgA.proposalId));
    expect(rows.map((r) => r.text)).toEqual(["The offeror shall submit three volumes."]);

    expect(
      await db.select({ key: complianceSeedDismissals.requirementKey }).from(complianceSeedDismissals).where(eq(complianceSeedDismissals.organizationId, fx.orgB.organizationId)),
    ).toEqual([]);
  });
});
