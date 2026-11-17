/**
 * BL-NAV-LIFECYCLE 5d-1 — the AI draft snapshot, the kept share at each
 * review, and the round kept on a reviewer's suggestion.
 * Asserts: tenant B reads none of tenant A's AI drafts or measures, and
 * cannot measure against A's proposal or round; a round is measured once;
 * a rewritten section measures lower than an untouched one; a reviewer's
 * suggestion keeps its round and colour while a teammate's does not, and
 * another tenant's reviewer is never matched; the AI draft snapshot cannot
 * be deleted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  proposalReviewAssignments,
  proposalReviews,
  proposalSectionSnapshots,
  proposalSections,
  sectionChangeDecisions,
  sectionDraftRetentions,
} from "@/db/schema";
import { loadDraftRetention, measureRetentionAtReview, recordAiDraftSnapshot, reviewRoundsForAuthors } from "@/lib/draft-learning";
import { fromPlainText } from "@/lib/tiptap-doc";
import { createTwoTenants, type TwoTenantFixture } from "../helpers/fixtures";

const sessionUserStub = {
  id: "PLACEHOLDER",
  email: "writer@learn.test",
  name: "Section Owner",
  image: null as null,
  isSuperadmin: false as const,
  organizationId: "PLACEHOLDER",
  role: "admin" as const,
};

vi.mock("@/lib/auth-helpers", () => ({
  requireAuth: async () => sessionUserStub,
  requireCurrentOrg: async () => ({ user: sessionUserStub, organizationId: sessionUserStub.organizationId, isImpersonating: false }),
  getSessionUser: async () => sessionUserStub,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { recordChangeDecisionsAction } from "@/app/(app)/proposals/[id]/sections/change-decision-actions";
import { deleteSectionSnapshotAction } from "@/app/(app)/proposals/[id]/sections/snapshot-actions";

const DRAFT = "Our team delivers secure cloud migration services on schedule and within the agreed budget every single time";
const REWRITE = "A completely different paragraph that a person wrote from nothing and that shares no run of words with the draft";

describe("BL-NAV-LIFECYCLE 5d-1 — draft learning", () => {
  let fx: TwoTenantFixture;
  let keptSection: string;
  let rewrittenSection: string;
  let sectionB: string;

  const addSection = async (proposalId: string, text: string) => {
    const [row] = await db
      .insert(proposalSections)
      .values({ proposalId, kind: "technical", title: "Technical", bodyDoc: fromPlainText(text), content: text })
      .returning({ id: proposalSections.id });
    return row!.id;
  };
  const startRound = async (proposalId: string, color: "pink" | "red", reviewerUserId: string, startedAt = new Date()) => {
    const [review] = await db
      .insert(proposalReviews)
      .values({ proposalId, color, status: "in_progress", startedAt })
      .returning({ id: proposalReviews.id });
    await db.insert(proposalReviewAssignments).values({ reviewId: review!.id, userId: reviewerUserId });
    return review!.id;
  };

  beforeEach(async () => {
    fx = await createTwoTenants("learn");
    sessionUserStub.id = fx.orgA.userId;
    sessionUserStub.organizationId = fx.orgA.organizationId;
    keptSection = await addSection(fx.orgA.proposalId, DRAFT);
    rewrittenSection = await addSection(fx.orgA.proposalId, REWRITE);
    sectionB = await addSection(fx.orgB.proposalId, DRAFT);
    for (const sectionId of [keptSection, rewrittenSection]) {
      await recordAiDraftSnapshot({ organizationId: fx.orgA.organizationId, proposalId: fx.orgA.proposalId, sectionId, draftText: DRAFT, requestedByUserId: fx.orgA.userId });
    }
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  it("measures the kept share once when a round starts, and reports it with the share kept now", async () => {
    const orgA = fx.orgA.organizationId;
    const reviewId = await startRound(fx.orgA.proposalId, "pink", fx.orgA.userId);

    expect(await measureRetentionAtReview({ organizationId: orgA, proposalId: fx.orgA.proposalId, reviewId })).toBe(2);
    // A second start of the same round writes nothing more.
    expect(await measureRetentionAtReview({ organizationId: orgA, proposalId: fx.orgA.proposalId, reviewId })).toBe(0);

    const rows = await db.select().from(sectionDraftRetentions).where(eq(sectionDraftRetentions.reviewId, reviewId));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.organizationId === orgA && r.reviewColor === "pink" && r.sectionKind === "technical")).toBe(true);
    expect(rows.find((r) => r.sectionId === keptSection)!.keptFraction).toBe(1);
    expect(rows.find((r) => r.sectionId === rewrittenSection)!.keptFraction).toBe(0);

    const retention = await loadDraftRetention({ organizationId: orgA, proposalId: fx.orgA.proposalId });
    expect(retention.reviews).toHaveLength(1);
    expect(retention.reviews[0]).toMatchObject({ reviewId, color: "pink", sections: 2, keptShare: 0.5 });
    expect(retention.now).toEqual({ sections: 2, keptShare: 0.5 });

    // The owner rewrites the kept section after Pink: the stored measure stays, "now" moves.
    await db.update(proposalSections).set({ bodyDoc: fromPlainText(REWRITE), content: REWRITE }).where(eq(proposalSections.id, keptSection));
    const later = await loadDraftRetention({ organizationId: orgA, proposalId: fx.orgA.proposalId });
    expect(later.reviews[0]!.keptShare).toBe(0.5);
    expect(later.now).toEqual({ sections: 2, keptShare: 0 });
  });

  it("grades against the newest AI draft of a section", async () => {
    const orgA = fx.orgA.organizationId;
    // Auto-draft runs again on the rewritten section and its text is that new draft.
    await recordAiDraftSnapshot({ organizationId: orgA, proposalId: fx.orgA.proposalId, sectionId: rewrittenSection, draftText: REWRITE, requestedByUserId: null });
    const retention = await loadDraftRetention({ organizationId: orgA, proposalId: fx.orgA.proposalId });
    expect(retention.now).toEqual({ sections: 2, keptShare: 1 });
  });

  it("keeps a tenant's AI drafts and measures to itself", async () => {
    const orgA = fx.orgA.organizationId;
    const orgB = fx.orgB.organizationId;
    const reviewA = await startRound(fx.orgA.proposalId, "pink", fx.orgA.userId);
    await measureRetentionAtReview({ organizationId: orgA, proposalId: fx.orgA.proposalId, reviewId: reviewA });

    // B, naming A's proposal and A's round: reads nothing, measures nothing.
    expect(await loadDraftRetention({ organizationId: orgB, proposalId: fx.orgA.proposalId })).toEqual({ reviews: [], now: null });
    const before = await db.select({ id: sectionDraftRetentions.id }).from(sectionDraftRetentions).where(eq(sectionDraftRetentions.reviewId, reviewA));
    expect(await measureRetentionAtReview({ organizationId: orgB, proposalId: fx.orgA.proposalId, reviewId: reviewA })).toBe(0);
    // B's own proposal with A's round is refused too.
    expect(await measureRetentionAtReview({ organizationId: orgB, proposalId: fx.orgB.proposalId, reviewId: reviewA })).toBe(0);
    const after = await db.select({ id: sectionDraftRetentions.id }).from(sectionDraftRetentions).where(eq(sectionDraftRetentions.reviewId, reviewA));
    expect(after).toHaveLength(before.length);
    expect(await db.select({ id: sectionDraftRetentions.id }).from(sectionDraftRetentions).where(eq(sectionDraftRetentions.organizationId, orgB))).toEqual([]);

    // B has no AI draft of its own, so nothing to report on its own proposal either.
    expect(await loadDraftRetention({ organizationId: orgB, proposalId: fx.orgB.proposalId })).toEqual({ reviews: [], now: null });
    expect(sectionB).toBeTruthy();
  });

  it("finds a reviewer's newest started round, and never another tenant's", async () => {
    const orgA = fx.orgA.organizationId;
    const pink = await startRound(fx.orgA.proposalId, "pink", fx.orgA.userId, new Date(Date.now() - 86_400_000));
    const red = await startRound(fx.orgA.proposalId, "red", fx.orgA.userId);
    // A scheduled round has not started: it never claims a suggestion.
    const [scheduled] = await db.insert(proposalReviews).values({ proposalId: fx.orgA.proposalId, color: "gold", status: "scheduled" }).returning({ id: proposalReviews.id });
    await db.insert(proposalReviewAssignments).values({ reviewId: scheduled!.id, userId: fx.orgA.userId });

    const rounds = await reviewRoundsForAuthors({ organizationId: orgA, proposalId: fx.orgA.proposalId, authorIds: [fx.orgA.userId, "forge-ai", ""] });
    expect(rounds.get(fx.orgA.userId)).toEqual({ reviewId: red, color: "red" });
    expect(rounds.size).toBe(1);
    expect(pink).not.toBe(red);

    // B asks about A's proposal: nothing.
    expect((await reviewRoundsForAuthors({ organizationId: fx.orgB.organizationId, proposalId: fx.orgA.proposalId, authorIds: [fx.orgA.userId] })).size).toBe(0);
  });

  it("records the round on a reviewer's suggestion and none on a teammate's", async () => {
    const orgA = fx.orgA.organizationId;
    const reviewId = await startRound(fx.orgA.proposalId, "pink", fx.orgA.userId);

    const res = await recordChangeDecisionsAction({
      proposalId: fx.orgA.proposalId,
      sectionId: keptSection,
      decisions: [
        { id: "c1", type: "insert", decision: "accept", authorId: fx.orgA.userId, authorName: "Reviewer", text: "a sentence the reviewer added" },
        { id: "c2", type: "delete", decision: "reject", authorId: "someone-else", authorName: "Teammate", text: "a sentence a teammate struck" },
      ],
    });
    expect(res).toEqual({ ok: true, recorded: 2 });

    const rows = await db
      .select({ changeId: sectionChangeDecisions.changeId, reviewId: sectionChangeDecisions.reviewId, reviewColor: sectionChangeDecisions.reviewColor })
      .from(sectionChangeDecisions)
      .where(and(eq(sectionChangeDecisions.organizationId, orgA), eq(sectionChangeDecisions.sectionId, keptSection)));
    expect(rows.find((r) => r.changeId === "c1")).toMatchObject({ reviewId, reviewColor: "pink" });
    expect(rows.find((r) => r.changeId === "c2")).toMatchObject({ reviewId: null, reviewColor: null });
  });

  it("keeps the AI draft snapshot when someone tries to delete it", async () => {
    const [snap] = await db
      .select({ id: proposalSectionSnapshots.id, kind: proposalSectionSnapshots.kind, label: proposalSectionSnapshots.label, wordCount: proposalSectionSnapshots.wordCount })
      .from(proposalSectionSnapshots)
      .where(and(eq(proposalSectionSnapshots.organizationId, fx.orgA.organizationId), eq(proposalSectionSnapshots.proposalSectionId, keptSection)));
    expect(snap).toMatchObject({ kind: "ai_draft", label: "AI draft", wordCount: 17 });

    const res = await deleteSectionSnapshotAction({ proposalId: fx.orgA.proposalId, sectionId: keptSection, snapshotId: snap!.id });
    expect(res.ok).toBe(false);
    expect(await db.select({ id: proposalSectionSnapshots.id }).from(proposalSectionSnapshots).where(eq(proposalSectionSnapshots.id, snap!.id))).toHaveLength(1);
  });
});
