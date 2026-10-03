/**
 * BL-FB-X-COLOR-TEAM — review workflow against Postgres. Two tenants.
 * Asserts: a reviewer's section scope is set through the owning tenant
 * only, refuses sections of another proposal and people who are not on
 * the round, mirrors the first section onto the legacy column; checklist
 * ticks upsert per reviewer and refuse lines the round does not carry;
 * the state loader returns nothing for a foreign tenant; all audited.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, proposalReviewAssignments, proposalReviews, proposalSections } from "@/db/schema";
import { getReviewWorkflow, setChecklistItem, setReviewerSections } from "@/lib/review-workflow";
import { REVIEW_CHECKLIST_TEMPLATES } from "@/lib/review-workflow-logic";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

describe("BL-FB-X-COLOR-TEAM — review workflow", () => {
  let fx: TwoTenantFixture;
  let reviewA = "";
  let secA1 = "";
  let secA2 = "";
  let secB = "";

  beforeEach(async () => {
    fx = await createTwoTenants("review-workflow");
    const a = await db
      .insert(proposalSections)
      .values([
        { proposalId: fx.orgA.proposalId, kind: "technical", title: "Technical approach", ordering: 1 },
        { proposalId: fx.orgA.proposalId, kind: "management", title: "Management approach", ordering: 2 },
      ])
      .returning({ id: proposalSections.id, ordering: proposalSections.ordering });
    secA1 = a.find((s) => s.ordering === 1)!.id;
    secA2 = a.find((s) => s.ordering === 2)!.id;
    const [b] = await db
      .insert(proposalSections)
      .values({ proposalId: fx.orgB.proposalId, kind: "technical", title: "B technical", ordering: 1 })
      .returning({ id: proposalSections.id });
    secB = b!.id;
    const [rev] = await db
      .insert(proposalReviews)
      .values({ proposalId: fx.orgA.proposalId, color: "red", status: "in_progress", checklist: REVIEW_CHECKLIST_TEMPLATES.red })
      .returning({ id: proposalReviews.id });
    reviewA = rev!.id;
    await db.insert(proposalReviewAssignments).values({ reviewId: reviewA, userId: fx.orgA.userId });
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("scopes a reviewer to sections through the owning tenant only", async () => {
    const actor = { userId: fx.orgA.userId, email: "a@test" };

    const foreign = await setReviewerSections({ organizationId: fx.orgB.organizationId, reviewId: reviewA, userId: fx.orgA.userId, sectionIds: [secA1], actor });
    expect(foreign).toEqual({ ok: false, error: "Review not found." });

    const crossProposal = await setReviewerSections({ organizationId: fx.orgA.organizationId, reviewId: reviewA, userId: fx.orgA.userId, sectionIds: [secA1, secB], actor });
    expect(crossProposal).toEqual({ ok: false, error: "One or more sections do not belong to this proposal." });

    const notOnRound = await setReviewerSections({ organizationId: fx.orgA.organizationId, reviewId: reviewA, userId: fx.orgB.userId, sectionIds: [secA1], actor });
    expect(notOnRound.ok).toBe(false);

    const ok = await setReviewerSections({ organizationId: fx.orgA.organizationId, reviewId: reviewA, userId: fx.orgA.userId, sectionIds: [secA2, secA1, secA2], actor });
    expect(ok).toEqual({ ok: true, proposalId: fx.orgA.proposalId, sectionIds: [secA2, secA1] });

    const state = await getReviewWorkflow({ organizationId: fx.orgA.organizationId, reviewId: reviewA });
    expect(state.sectionAssignments.map((s) => s.sectionId).sort()).toEqual([secA1, secA2].sort());
    const [legacy] = await db
      .select({ sectionId: proposalReviewAssignments.sectionId })
      .from(proposalReviewAssignments)
      .where(and(eq(proposalReviewAssignments.reviewId, reviewA), eq(proposalReviewAssignments.userId, fx.orgA.userId)));
    expect(legacy!.sectionId).toBe(secA2);

    // Back to the whole proposal: rows gone, legacy column cleared.
    const whole = await setReviewerSections({ organizationId: fx.orgA.organizationId, reviewId: reviewA, userId: fx.orgA.userId, sectionIds: [], actor });
    expect(whole.ok).toBe(true);
    expect((await getReviewWorkflow({ organizationId: fx.orgA.organizationId, reviewId: reviewA })).sectionAssignments).toEqual([]);
    expect(await getReviewWorkflow({ organizationId: fx.orgB.organizationId, reviewId: reviewA })).toEqual({ sectionAssignments: [], checklistStates: [] });

    const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.organizationId, fx.orgA.organizationId));
    expect(audits.filter((a) => a.action === "proposal.review.sections.set")).toHaveLength(2);
  });

  it("ticks the checklist per reviewer, upserting, and refuses unknown lines and closed rounds", async () => {
    const actor = { userId: fx.orgA.userId, email: "a@test" };
    const base = { organizationId: fx.orgA.organizationId, reviewId: reviewA, userId: fx.orgA.userId, actor };

    expect(await setChecklistItem({ ...base, itemKey: "not_a_line", checked: true })).toEqual({ ok: false, error: "That checklist line is not part of this round." });
    expect((await setChecklistItem({ ...base, organizationId: fx.orgB.organizationId, itemKey: "m_factors", checked: true })).ok).toBe(false);
    expect((await setChecklistItem({ ...base, userId: fx.orgB.userId, itemKey: "m_factors", checked: true })).ok).toBe(false);

    expect(await setChecklistItem({ ...base, itemKey: "m_factors", checked: true, note: "  Factor 2 thin. " })).toEqual({ ok: true, proposalId: fx.orgA.proposalId });
    expect((await setChecklistItem({ ...base, itemKey: "m_factors", checked: false, note: "Re-opened" })).ok).toBe(true);
    expect((await setChecklistItem({ ...base, itemKey: "compliance_complete", checked: true })).ok).toBe(true);

    const state = await getReviewWorkflow({ organizationId: fx.orgA.organizationId, reviewId: reviewA });
    expect(state.checklistStates.map((s) => [s.itemKey, s.checked, s.note]).sort()).toEqual([
      ["compliance_complete", true, ""],
      ["m_factors", false, "Re-opened"],
    ]);

    await db.update(proposalReviews).set({ status: "complete" }).where(eq(proposalReviews.id, reviewA));
    expect(await setChecklistItem({ ...base, itemKey: "m_factors", checked: true })).toEqual({ ok: false, error: "This review is closed." });
    expect(await setReviewerSections({ ...base, sectionIds: [secA1] })).toEqual({ ok: false, error: "This review is closed." });

    const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.organizationId, fx.orgA.organizationId));
    expect(audits.filter((a) => a.action === "proposal.review.checklist.set")).toHaveLength(3);
  });
});
