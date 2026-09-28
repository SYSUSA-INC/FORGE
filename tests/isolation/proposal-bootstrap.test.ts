/**
 * BL-AIP-5b — applying a Section L outline to a proposal, against
 * Postgres. No model call: the plan is given. Asserts the seeded
 * template is replaced on create, a rebuild keeps written sections and
 * refreshes matched ones, themes and the due date are set only when
 * empty, the record lands on the proposal, and tenant B cannot apply a
 * plan to A's proposal.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { opportunities, proposalSections, proposals } from "@/db/schema";
import { applyProposalBootstrap, opportunityHasSectionL } from "@/lib/proposal-bootstrap";
import type { BootstrapPlan } from "@/lib/proposal-bootstrap-plan";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const PLAN: BootstrapPlan = {
  sections: [
    { title: "Volume I — Technical Approach", kind: "technical", pageLimit: 25, instructions: "Describe the approach to each PWS task.", sourceRef: "L.4.2" },
    { title: "Volume II — Past Performance", kind: "past_performance", pageLimit: 10, instructions: "Three references within five years.", sourceRef: "L.4.3" },
    { title: "Volume III — Price", kind: "pricing", pageLimit: null, instructions: "Complete Attachment 3.", sourceRef: "L.4.4" },
  ],
  dueDate: "2026-12-01",
  proposedThemes: [
    { title: "Zero-risk transition", statement: "A staffed transition team from day one.", rationale: "Factor 2" },
  ],
  notes: "12-point font, one-inch margins.",
};

async function sectionsOf(proposalId: string) {
  return db
    .select({
      id: proposalSections.id,
      title: proposalSections.title,
      kind: proposalSections.kind,
      ordering: proposalSections.ordering,
      pageLimit: proposalSections.pageLimit,
      instructions: proposalSections.instructions,
      wordCount: proposalSections.wordCount,
    })
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, proposalId))
    .orderBy(asc(proposalSections.ordering));
}

describe("BL-AIP-5b — applyProposalBootstrap", () => {
  let fx: TwoTenantFixture;

  beforeEach(async () => {
    fx = await createTwoTenants("bootstrap");
    // The template's seed: all empty, plus one section the author wrote.
    await db.insert(proposalSections).values([
      { proposalId: fx.orgA.proposalId, kind: "executive_summary", title: "Executive Summary", ordering: 1 },
      { proposalId: fx.orgA.proposalId, kind: "technical", title: "Technical Approach", ordering: 2, pageLimit: 5 },
      { proposalId: fx.orgA.proposalId, kind: "management", title: "Management Approach", ordering: 3 },
      {
        proposalId: fx.orgA.proposalId,
        kind: "pricing",
        title: "Pricing Notes",
        ordering: 4,
        content: "Firm fixed price with a 3% escalation.",
        wordCount: 7,
      },
    ]);
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("replaces empty template sections, keeps written ones, seeds themes and the due date", async () => {
    const res = await applyProposalBootstrap({
      organizationId: fx.orgA.organizationId,
      proposalId: fx.orgA.proposalId,
      plan: PLAN,
      mode: "create",
      actor: { userId: fx.orgA.userId },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.applied).toEqual({
      mode: "create",
      sectionsInserted: 2,
      sectionsUpdated: 1,
      sectionsRemoved: 2,
      sectionsKept: 1,
      themesSeeded: true,
      dueDateSet: true,
    });

    const after = await sectionsOf(fx.orgA.proposalId);
    expect(after.map((s) => [s.title, s.ordering, s.pageLimit])).toEqual([
      ["Technical Approach", 1, 25],
      ["Volume II — Past Performance", 2, 10],
      ["Volume III — Price", 3, null],
      ["Pricing Notes", 4, null],
    ]);
    expect(after[0]!.instructions).toBe("Describe the approach to each PWS task.");
    expect(after[3]!.wordCount).toBe(7);

    const [prop] = await db
      .select({ winThemes: proposals.winThemes, bootstrap: proposals.bootstrap })
      .from(proposals)
      .where(eq(proposals.id, fx.orgA.proposalId));
    expect(prop?.winThemes).toEqual([
      { title: "Zero-risk transition", statement: "A staffed transition team from day one." },
    ]);
    expect(prop?.bootstrap?.sections).toHaveLength(3);
    expect(prop?.bootstrap?.notes).toBe("12-point font, one-inch margins.");

    const [opp] = await db
      .select({ responseDueDate: opportunities.responseDueDate })
      .from(opportunities)
      .where(eq(opportunities.id, fx.orgA.opportunityId));
    expect(opp?.responseDueDate?.toISOString().slice(0, 10)).toBe("2026-12-01");

    // A rebuild never overwrites the team's own themes or a set due date.
    await db
      .update(proposals)
      .set({ winThemes: [{ title: "Ours", statement: "Our own theme." }] })
      .where(eq(proposals.id, fx.orgA.proposalId));
    const again = await applyProposalBootstrap({
      organizationId: fx.orgA.organizationId,
      proposalId: fx.orgA.proposalId,
      plan: { ...PLAN, dueDate: "2027-01-15" },
      mode: "rebuild",
      actor: { userId: fx.orgA.userId },
    });
    expect(again.ok && again.record.applied).toMatchObject({
      sectionsInserted: 0,
      sectionsUpdated: 3,
      sectionsRemoved: 0,
      sectionsKept: 1,
      themesSeeded: false,
      dueDateSet: false,
    });
    const [oppAfter] = await db
      .select({ responseDueDate: opportunities.responseDueDate })
      .from(opportunities)
      .where(eq(opportunities.id, fx.orgA.opportunityId));
    expect(oppAfter?.responseDueDate?.toISOString().slice(0, 10)).toBe("2026-12-01");
  });

  it("is tenant-isolated: B cannot apply a plan to A's proposal", async () => {
    const cross = await applyProposalBootstrap({
      organizationId: fx.orgB.organizationId,
      proposalId: fx.orgA.proposalId,
      plan: PLAN,
      mode: "rebuild",
      actor: { userId: fx.orgB.userId },
    });
    expect(cross).toEqual({ ok: false, error: "Proposal not found." });
    expect(await sectionsOf(fx.orgA.proposalId)).toHaveLength(4);

    expect(
      await opportunityHasSectionL({
        organizationId: fx.orgB.organizationId,
        opportunityId: fx.orgA.opportunityId,
      }),
    ).toBe(false);
  });
});
