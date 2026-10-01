/**
 * BL-AIP-6b — review comments in the editor against Postgres. Two
 * tenants. Asserts: the per-section listing returns the deciding
 * tenant's open, section-anchored comments only (AI author = null);
 * resolving goes through the owning tenant only and is audited with
 * where it came from.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, proposalReviewComments, proposalReviews, proposalSections } from "@/db/schema";
import { AI_REVIEW_PREFIX } from "@/lib/review-comments";
import { listOpenReviewCommentsBySection, setReviewCommentResolved } from "@/lib/section-review-comments";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

describe("BL-AIP-6b — review comments in the editor", () => {
  let fx: TwoTenantFixture;
  let sectionA = "";
  let reviewA = "";
  let aiComment = "";
  let humanComment = "";

  beforeEach(async () => {
    fx = await createTwoTenants("review-comments");
    const [sec] = await db
      .insert(proposalSections)
      .values({ proposalId: fx.orgA.proposalId, kind: "technical", title: "Technical approach" })
      .returning({ id: proposalSections.id });
    sectionA = sec!.id;
    const [rev] = await db
      .insert(proposalReviews)
      .values({ proposalId: fx.orgA.proposalId, color: "pink" })
      .returning({ id: proposalReviews.id });
    reviewA = rev!.id;
    const rows = await db
      .insert(proposalReviewComments)
      .values([
        { reviewId: reviewA, sectionId: sectionA, userId: null, body: `${AI_REVIEW_PREFIX} · high] The section never names the incumbent.` },
        { reviewId: reviewA, sectionId: sectionA, userId: fx.orgA.userId, body: "Cite the PWS paragraph." },
        { reviewId: reviewA, sectionId: sectionA, userId: fx.orgA.userId, body: "Already handled.", resolved: true },
        { reviewId: reviewA, sectionId: null, userId: fx.orgA.userId, body: "Overall verdict comment." },
      ])
      .returning({ id: proposalReviewComments.id, body: proposalReviewComments.body });
    aiComment = rows.find((r) => r.body.startsWith(AI_REVIEW_PREFIX))!.id;
    humanComment = rows.find((r) => r.body === "Cite the PWS paragraph.")!.id;
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("lists the open, section-anchored comments of the deciding tenant only", async () => {
    const a = await listOpenReviewCommentsBySection({ organizationId: fx.orgA.organizationId, proposalId: fx.orgA.proposalId });
    expect(Object.keys(a)).toEqual([sectionA]);
    expect(a[sectionA]!.map((c) => [c.id, c.authorName, c.color, c.reviewId])).toEqual([
      [aiComment, null, "pink", reviewA],
      [humanComment, expect.stringContaining("Test "), "pink", reviewA],
    ]);
    expect(a[sectionA]![0]!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Another tenant asking about A's proposal gets nothing; its own has none.
    expect(await listOpenReviewCommentsBySection({ organizationId: fx.orgB.organizationId, proposalId: fx.orgA.proposalId })).toEqual({});
    expect(await listOpenReviewCommentsBySection({ organizationId: fx.orgB.organizationId, proposalId: fx.orgB.proposalId })).toEqual({});
  });

  it("resolves only through the owning tenant and audits where it came from", async () => {
    const foreign = await setReviewCommentResolved({
      organizationId: fx.orgB.organizationId,
      commentId: aiComment,
      resolved: true,
      actor: { userId: fx.orgB.userId },
      via: "editor",
    });
    expect(foreign).toEqual({ ok: false, error: "Comment not found." });
    expect(
      (await listOpenReviewCommentsBySection({ organizationId: fx.orgA.organizationId, proposalId: fx.orgA.proposalId }))[sectionA],
    ).toHaveLength(2);

    const res = await setReviewCommentResolved({
      organizationId: fx.orgA.organizationId,
      commentId: aiComment,
      resolved: true,
      actor: { userId: fx.orgA.userId, email: "a@test" },
      via: "editor",
    });
    expect(res).toEqual({ ok: true, proposalId: fx.orgA.proposalId, reviewId: reviewA });
    const after = await listOpenReviewCommentsBySection({ organizationId: fx.orgA.organizationId, proposalId: fx.orgA.proposalId });
    expect(after[sectionA]!.map((c) => c.id)).toEqual([humanComment]);

    const audits = await db
      .select({ action: auditLogs.action, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, fx.orgA.organizationId), eq(auditLogs.resourceType, "proposal_review_comment")));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe("proposal.review.comment.resolve");
    expect(audits[0]!.metadata).toMatchObject({ reviewId: reviewA, proposalId: fx.orgA.proposalId, via: "editor" });
    const none = await db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, fx.orgB.organizationId), eq(auditLogs.resourceType, "proposal_review_comment")));
    expect(none).toHaveLength(0);

    // Reopened from the review page: back in the editor's list.
    const reopened = await setReviewCommentResolved({
      organizationId: fx.orgA.organizationId,
      commentId: aiComment,
      resolved: false,
      actor: { userId: fx.orgA.userId },
      via: "review",
    });
    expect(reopened.ok).toBe(true);
    expect(
      (await listOpenReviewCommentsBySection({ organizationId: fx.orgA.organizationId, proposalId: fx.orgA.proposalId }))[sectionA],
    ).toHaveLength(2);
  });
});
