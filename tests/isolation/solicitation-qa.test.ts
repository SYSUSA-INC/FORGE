/**
 * BL-FB-SOL-QA — contracting-officer Q&A against Postgres. Two tenants.
 * Asserts: pasted Q&A lands on the owning tenant's solicitation only,
 * answers match the requirements they refine and flag the compliance
 * rows of this tenant's proposals, a second paste stores nothing twice,
 * polling without a notice ID is refused, and the adds are audited.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, complianceItems, solicitations } from "@/db/schema";
import { seedComplianceItemsFromRequirements } from "@/lib/compliance-seed";
import { addManualQa, listSolicitationQa, pollSolicitationQa } from "@/lib/solicitation-qa";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const QA_TEXT = `Q1: Does Section L.5.2.1 require resumes for all key personnel?
A1: No. Section L.5.2.1 is amended: resumes are required for the program manager and the technical lead only.

Q2: May monthly status reports to the COR be delivered by email?
A2: Yes, monthly status reports may be delivered to the COR by email in PDF.

Q3: Is there an incumbent?
A3: Yes, see the award notice.`;

describe("BL-FB-SOL-QA — contracting-officer Q&A", () => {
  let fx: TwoTenantFixture;
  let solicitationA = "";

  beforeEach(async () => {
    fx = await createTwoTenants("sol-qa");
    const [s] = await db
      .insert(solicitations)
      .values({
        organizationId: fx.orgA.organizationId,
        opportunityId: fx.orgA.opportunityId,
        title: "Q&A test RFP",
        parseStatus: "parsed",
        extractedRequirements: [
          { kind: "shall", ref: "L.5.2.1", text: "The offeror shall provide resumes for all key personnel." },
          { kind: "should", ref: "PWS 3.2", text: "The contractor should provide monthly status reports to the COR." },
          { kind: "shall", ref: "M-1", text: "Proposals will be evaluated on technical approach and past performance." },
        ],
      })
      .returning({ id: solicitations.id });
    solicitationA = s!.id;
    const seeded = await seedComplianceItemsFromRequirements({
      organizationId: fx.orgA.organizationId,
      proposalId: fx.orgA.proposalId,
      actor: { id: fx.orgA.userId, email: "a@test" },
    });
    expect(seeded.ok).toBe(true);
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("stores pasted answers for the owner only, matches and flags, never twice", async () => {
    const actor = { userId: fx.orgA.userId, email: "a@test" };
    const first = await addManualQa({ organizationId: fx.orgA.organizationId, solicitationId: solicitationA, text: QA_TEXT, actor });
    expect(first).toEqual({ ok: true, added: 3, duplicates: 0, flagged: 2 });

    const listA = await listSolicitationQa({ organizationId: fx.orgA.organizationId, solicitationId: solicitationA });
    expect(listA.map((q) => q.ordinal)).toEqual([1, 2, 3]);
    expect(listA[0]).toMatchObject({ source: "manual", sourceRef: "pasted", affectedRefs: ["L.5.2.1"] });
    expect(listA[0]!.addedByName).toContain("Test ");
    expect(listA[1]!.affectedRefs).toEqual(["PWS 3.2"]);
    expect(listA[2]!.affectedRefs).toEqual([]);
    expect(await listSolicitationQa({ organizationId: fx.orgB.organizationId, solicitationId: solicitationA })).toEqual([]);

    // The compliance rows of the owner's proposal carry the answer.
    const rows = await db
      .select({ number: complianceItems.number, amendedByQaId: complianceItems.amendedByQaId })
      .from(complianceItems)
      .where(eq(complianceItems.proposalId, fx.orgA.proposalId));
    const byNumber = new Map(rows.map((r) => [r.number, r.amendedByQaId]));
    expect(byNumber.get("L.5.2.1")).toBe(listA[0]!.id);
    expect(byNumber.get("PWS 3.2")).toBe(listA[1]!.id);
    expect(byNumber.get("M-1")).toBeNull();

    // Another tenant can neither add to nor poll A's solicitation.
    expect(await addManualQa({ organizationId: fx.orgB.organizationId, solicitationId: solicitationA, text: QA_TEXT, actor: { userId: fx.orgB.userId } })).toEqual({ ok: false, error: "Solicitation not found." });
    expect((await pollSolicitationQa({ organizationId: fx.orgB.organizationId, solicitationId: solicitationA })).ok).toBe(false);

    // The same text again stores nothing twice; unparsable text is refused.
    expect(await addManualQa({ organizationId: fx.orgA.organizationId, solicitationId: solicitationA, text: QA_TEXT, actor })).toEqual({ ok: true, added: 0, duplicates: 3, flagged: 0 });
    expect((await addManualQa({ organizationId: fx.orgA.organizationId, solicitationId: solicitationA, text: "The offeror shall comply.", actor })).ok).toBe(false);

    // No notice ID: polling is refused before SAM.gov is called.
    const poll = await pollSolicitationQa({ organizationId: fx.orgA.organizationId, solicitationId: solicitationA, actor });
    expect(poll.ok).toBe(false);
    if (!poll.ok) expect(poll.error).toMatch(/no SAM\.gov notice ID/);

    const audits = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, fx.orgA.organizationId));
    expect(audits.filter((a) => a.action === "solicitation.qa.add")).toHaveLength(2);
    const foreign = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, fx.orgB.organizationId));
    expect(foreign.filter((a) => a.action.startsWith("solicitation.qa"))).toHaveLength(0);
  });
});
