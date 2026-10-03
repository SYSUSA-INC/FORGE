/**
 * BL-FB-X-COLOR-TEAM Slice 2 — round follow-ups against Postgres. Two
 * tenants. Asserts: open comments carry from a closed round into the
 * next one of the same proposal only (originals resolved, lineage kept,
 * foreign tenant and other proposal refused); the AI debrief is stored
 * for the owning tenant, gated for the other, heuristic under the stub
 * provider; the due-date reminder reaches only the reviewers who have
 * not submitted, once; everything audited.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLogs,
  notificationDeliveries,
  notificationRules,
  proposalReviewAssignments,
  proposalReviewComments,
  proposalReviews,
  proposalSections,
} from "@/db/schema";
import { getAIProviderStatus } from "@/lib/ai";
import { dispatchReviewDueReminders } from "@/lib/review-reminders";
import { summarizeReview } from "@/lib/review-summary";
import { carryOpenComments } from "@/lib/review-workflow";
import { REVIEW_CHECKLIST_TEMPLATES } from "@/lib/review-workflow-logic";
import { createTierAndSubscribe, createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

describe("BL-FB-X-COLOR-TEAM Slice 2 — round follow-ups", () => {
  let fx: TwoTenantFixture;
  let tierA: { cleanup: () => Promise<void> };
  let sectionA = "";
  let pinkA = "";
  let redA = "";
  let reviewB = "";
  const tag = Date.now().toString(36);

  beforeEach(async () => {
    fx = await createTwoTenants("review-followups");
    tierA = await createTierAndSubscribe({
      organizationId: fx.orgA.organizationId,
      slug: `rf-a-${tag}`,
      name: "Followups A",
      featureFlags: { aiAutoDraft: true },
      quotas: { aiTokensPerMonth: 0, aiRequestsPerMonth: 100 },
    });
    const [sec] = await db
      .insert(proposalSections)
      .values({ proposalId: fx.orgA.proposalId, kind: "technical", title: "Technical approach", ordering: 1 })
      .returning({ id: proposalSections.id });
    sectionA = sec!.id;
    const [pink] = await db
      .insert(proposalReviews)
      .values({ proposalId: fx.orgA.proposalId, color: "pink", status: "complete", verdict: "conditional", closedAt: new Date() })
      .returning({ id: proposalReviews.id });
    pinkA = pink!.id;
    const [red] = await db
      .insert(proposalReviews)
      .values({ proposalId: fx.orgA.proposalId, color: "red", status: "in_progress", checklist: REVIEW_CHECKLIST_TEMPLATES.red })
      .returning({ id: proposalReviews.id });
    redA = red!.id;
    const [b] = await db
      .insert(proposalReviews)
      .values({ proposalId: fx.orgB.proposalId, color: "red", status: "in_progress" })
      .returning({ id: proposalReviews.id });
    reviewB = b!.id;
    await db.insert(proposalReviewComments).values([
      { reviewId: pinkA, sectionId: sectionA, userId: fx.orgA.userId, body: "Name the incumbent and the contract number." },
      { reviewId: pinkA, sectionId: null, userId: null, body: "[FORGE AI pre-review · medium] Strong opening; the transition plan lacks dates." },
      { reviewId: pinkA, sectionId: sectionA, userId: fx.orgA.userId, body: "Fixed already.", resolved: true },
    ]);
  });

  afterEach(async () => {
    await tierA.cleanup();
    await fx.cleanup();
  });

  it("carries open comments into the next round of the same proposal only", async () => {
    const actor = { userId: fx.orgA.userId, email: "a@test" };
    expect(await carryOpenComments({ organizationId: fx.orgB.organizationId, fromReviewId: pinkA, toReviewId: redA, actor })).toEqual({ ok: false, error: "Review not found." });
    expect((await carryOpenComments({ organizationId: fx.orgA.organizationId, fromReviewId: pinkA, toReviewId: reviewB, actor })).ok).toBe(false);
    expect((await carryOpenComments({ organizationId: fx.orgA.organizationId, fromReviewId: pinkA, toReviewId: pinkA, actor })).ok).toBe(false);

    expect(await carryOpenComments({ organizationId: fx.orgA.organizationId, fromReviewId: pinkA, toReviewId: redA, actor })).toEqual({ ok: true, carried: 2 });

    const red = await db.select().from(proposalReviewComments).where(eq(proposalReviewComments.reviewId, redA));
    expect(red).toHaveLength(2);
    expect(red.every((c) => !c.resolved && c.carriedFromCommentId)).toBe(true);
    expect(red.map((c) => c.body).sort()).toEqual(["Name the incumbent and the contract number.", "[FORGE AI pre-review · medium] Strong opening; the transition plan lacks dates."].sort());
    expect(red.find((c) => c.userId === null)?.sectionId).toBeNull();
    const pink = await db.select({ resolved: proposalReviewComments.resolved }).from(proposalReviewComments).where(eq(proposalReviewComments.reviewId, pinkA));
    expect(pink.every((c) => c.resolved)).toBe(true);
    const [round] = await db.select({ carriedFromReviewId: proposalReviews.carriedFromReviewId }).from(proposalReviews).where(eq(proposalReviews.id, redA));
    expect(round!.carriedFromReviewId).toBe(pinkA);

    // A second carry from the now-empty round moves nothing.
    expect(await carryOpenComments({ organizationId: fx.orgA.organizationId, fromReviewId: pinkA, toReviewId: redA, actor })).toEqual({ ok: true, carried: 0 });
    const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.organizationId, fx.orgA.organizationId));
    expect(audits.filter((a) => a.action === "proposal.review.carry")).toHaveLength(2);
  });

  it("summarises the round for the owning tenant, gated, stored and audited", async () => {
    const actor = { userId: fx.orgA.userId, email: "a@test" };
    expect(await summarizeReview({ organizationId: fx.orgB.organizationId, reviewId: pinkA, actor })).toEqual({ ok: false, error: "Review not found." });
    // An empty round has nothing to say; tenant B has no tier with the feature.
    expect((await summarizeReview({ organizationId: fx.orgA.organizationId, reviewId: redA, actor })).ok).toBe(false);
    await db.insert(proposalReviewComments).values({ reviewId: reviewB, sectionId: null, userId: fx.orgB.userId, body: "Needs work." });
    expect((await summarizeReview({ organizationId: fx.orgB.organizationId, reviewId: reviewB, actor: { userId: fx.orgB.userId } })).ok).toBe(false);

    await db.insert(proposalReviewAssignments).values({ reviewId: pinkA, userId: fx.orgA.userId, verdict: "conditional", submittedAt: new Date(), summary: "Fix the PP volume." });
    const res = await summarizeReview({ organizationId: fx.orgA.organizationId, reviewId: pinkA, actor });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.summary.headline.length).toBeGreaterThan(10);
    if (getAIProviderStatus().active.name === "stub") {
      expect(res.stubbed).toBe(true);
      expect(res.fallback).toBe(true);
      expect(res.summary.headline).toContain("Pink Team: 2 open comments");
      expect(res.summary.mustFix[0]).toMatch(/^§1 Technical approach: Name the incumbent/);
      expect(res.summary.strengths).toEqual(["[FORGE AI pre-review · medium] Strong opening; the transition plan lacks dates."]);
    }
    const [stored] = await db.select({ aiSummary: proposalReviews.aiSummary, aiSummaryAt: proposalReviews.aiSummaryAt }).from(proposalReviews).where(eq(proposalReviews.id, pinkA));
    expect(stored!.aiSummary?.headline).toBe(res.summary.headline);
    expect(stored!.aiSummaryAt).not.toBeNull();
    const audits = await db.select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.organizationId, fx.orgA.organizationId));
    expect(audits.filter((a) => a.action === "proposal.review.summarize")).toHaveLength(1);
  });

  it("reminds only the reviewers who have not submitted, once", async () => {
    const [rule] = await db
      .insert(notificationRules)
      .values({
        organizationId: fx.orgA.organizationId,
        name: "Test: review due soon",
        triggerEventKind: "review_due_soon",
        recipientStrategy: "mentioned_in_payload",
        channels: ["in_app"],
        frequency: "immediate",
        active: true,
      })
      .returning({ id: notificationRules.id });
    const tomorrow = new Date(Date.now() + 20 * 60 * 60 * 1000);
    await db.update(proposalReviews).set({ dueDate: tomorrow }).where(eq(proposalReviews.id, redA));
    await db.insert(proposalReviewAssignments).values([
      { reviewId: redA, userId: fx.orgA.userId },
      { reviewId: redA, userId: fx.orgB.userId, verdict: "pass", submittedAt: new Date() },
    ]);
    // Tenant B's round is due next week: not yet.
    await db.update(proposalReviews).set({ dueDate: new Date(Date.now() + 7 * 86_400_000) }).where(eq(proposalReviews.id, reviewB));

    const first = await dispatchReviewDueReminders();
    expect(first.reviewsDue).toBeGreaterThanOrEqual(1);
    const deliveries = await db
      .select({ recipientUserId: notificationDeliveries.recipientUserId })
      .from(notificationDeliveries)
      .where(and(eq(notificationDeliveries.organizationId, fx.orgA.organizationId), eq(notificationDeliveries.ruleId, rule!.id)));
    expect(deliveries.map((d) => d.recipientUserId)).toEqual([fx.orgA.userId]);
    const [stamped] = await db.select({ at: proposalReviews.dueReminderSentAt }).from(proposalReviews).where(eq(proposalReviews.id, redA));
    expect(stamped!.at).not.toBeNull();

    await dispatchReviewDueReminders();
    const again = await db
      .select({ id: notificationDeliveries.id })
      .from(notificationDeliveries)
      .where(and(eq(notificationDeliveries.organizationId, fx.orgA.organizationId), eq(notificationDeliveries.ruleId, rule!.id)));
    expect(again).toHaveLength(1);
    const [untouched] = await db.select({ at: proposalReviews.dueReminderSentAt }).from(proposalReviews).where(eq(proposalReviews.id, reviewB));
    expect(untouched!.at).toBeNull();
  });
});
