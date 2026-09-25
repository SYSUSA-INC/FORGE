/**
 * BL-AIP-5 — seeding the compliance matrix from extracted requirements.
 *
 * Runtime test against Postgres: two tenants, a parsed solicitation on
 * tenant A's opportunity, then the seed. Asserts the rows land on the
 * right proposal with the right categories, near-duplicates are skipped,
 * a second run is a no-op, and tenant B can neither seed A's proposal
 * nor see A's requirements.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { complianceItems, solicitations } from "@/db/schema";
import { seedComplianceItemsFromRequirements } from "@/lib/compliance-seed";
import { loadOpportunityRequirements } from "@/lib/solicitation-requirements";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

describe("BL-AIP-5 — seedComplianceItemsFromRequirements", () => {
  let fx: TwoTenantFixture;

  beforeEach(async () => {
    fx = await createTwoTenants("compliance-seed");
    await db.insert(solicitations).values({
      organizationId: fx.orgA.organizationId,
      opportunityId: fx.orgA.opportunityId,
      title: "Seed test RFP",
      parseStatus: "parsed",
      sectionLSummary: "Thirty pages, three volumes.",
      sectionMSummary: "Best value.",
      extractedRequirements: [
        { kind: "shall", ref: "L.5.2.1", text: "The offeror shall describe its staffing approach for all task areas." },
        { kind: "shall", ref: "M-1", text: "Proposals will be evaluated on technical approach and past performance." },
        { kind: "should", ref: "PWS 3.2", text: "The contractor should provide monthly status reports to the COR." },
        // Near-duplicate of the PWS clause: skipped.
        { kind: "shall", ref: "C.3.2", text: "Contractor shall provide monthly status reports to the COR" },
      ],
    });
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("creates categorised rows once and skips duplicates on re-run", async () => {
    const first = await seedComplianceItemsFromRequirements({
      organizationId: fx.orgA.organizationId,
      proposalId: fx.orgA.proposalId,
      actor: { id: fx.orgA.userId, email: "a@test" },
    });
    expect(first).toEqual({
      ok: true,
      inserted: 3,
      skippedDuplicates: 1,
      available: 4,
      solicitationCount: 1,
    });

    const rows = await db
      .select({
        category: complianceItems.category,
        number: complianceItems.number,
        requirementText: complianceItems.requirementText,
        status: complianceItems.status,
        notes: complianceItems.notes,
      })
      .from(complianceItems)
      .where(eq(complianceItems.proposalId, fx.orgA.proposalId))
      .orderBy(asc(complianceItems.ordering));
    expect(rows.map((r) => [r.category, r.number])).toEqual([
      ["section_l", "L.5.2.1"],
      ["section_m", "M-1"],
      ["section_c", "PWS 3.2"],
    ]);
    expect(rows.every((r) => r.status === "not_addressed")).toBe(true);
    expect(rows[2]!.notes).toContain('"should"');

    const again = await seedComplianceItemsFromRequirements({
      organizationId: fx.orgA.organizationId,
      proposalId: fx.orgA.proposalId,
      actor: { id: fx.orgA.userId },
    });
    expect(again).toMatchObject({ ok: true, inserted: 0, skippedDuplicates: 4 });
    const count = await db
      .select({ id: complianceItems.id })
      .from(complianceItems)
      .where(eq(complianceItems.proposalId, fx.orgA.proposalId));
    expect(count).toHaveLength(3);
  });

  it("is tenant-isolated: B cannot seed A's proposal and sees none of A's requirements", async () => {
    const cross = await seedComplianceItemsFromRequirements({
      organizationId: fx.orgB.organizationId,
      proposalId: fx.orgA.proposalId,
      actor: { id: fx.orgB.userId },
    });
    expect(cross).toEqual({ ok: false, error: "Proposal not found." });

    const own = await seedComplianceItemsFromRequirements({
      organizationId: fx.orgB.organizationId,
      proposalId: fx.orgB.proposalId,
      actor: { id: fx.orgB.userId },
    });
    expect(own).toMatchObject({ ok: true, inserted: 0, available: 0, solicitationCount: 0 });

    // The loader that feeds the drafter, chat and scans is scoped the same way.
    const leak = await loadOpportunityRequirements({
      organizationId: fx.orgB.organizationId,
      opportunityId: fx.orgA.opportunityId,
    });
    expect(leak.requirements).toEqual([]);
    const legit = await loadOpportunityRequirements({
      organizationId: fx.orgA.organizationId,
      opportunityId: fx.orgA.opportunityId,
    });
    expect(legit.requirements).toHaveLength(4);
    expect(legit.sectionLSummary).toBe("Thirty pages, three volumes.");
  });
});
