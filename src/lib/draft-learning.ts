/**
 * BL-NAV-LIFECYCLE 5d-1 — learning how the company writes, against Postgres
 * (design §2.5):
 *   - `recordAiDraftSnapshot`: the text FORGE AI wrote for a section, kept
 *     as a `proposal_section_snapshot` of kind `ai_draft` so the final text
 *     can be compared with it;
 *   - `measureRetentionAtReview`: when a colour-team round starts, how much
 *     of each section's AI draft is still in its text;
 *   - `loadDraftRetention`: those measures, and the share kept now;
 *   - `reviewRoundsForAuthors`: which round a tracked suggestion's author
 *     was reviewing in, so the decision on it keeps the colour.
 *
 * Server-only. Callers own auth and pass the organizationId from
 * `requireCurrentOrg` (or the job's own organization); sections and
 * rounds are reached through their proposal's organization. Nothing here
 * reads another tenant's rows.
 */
import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  proposalReviewAssignments,
  proposalReviews,
  proposalSectionSnapshots,
  proposalSections,
  proposals,
  sectionDraftRetentions,
  type TipTapDoc,
} from "@/db/schema";
import {
  keptShare,
  latestPerSection,
  measureRetention,
  retentionByReview,
  roundByReviewer,
  type ReviewRetention,
} from "@/lib/draft-learning-logic";
import { countWords, fromPlainText, projectToPlain, validateDoc } from "@/lib/tiptap-doc";

export const AI_DRAFT_SNAPSHOT_LABEL = "AI draft";

/** Keep the text FORGE AI just wrote for a section. The caller has already checked the section is this organization's. */
export async function recordAiDraftSnapshot(input: {
  organizationId: string;
  proposalId: string;
  sectionId: string;
  draftText: string;
  requestedByUserId: string | null;
}): Promise<void> {
  const bodyDoc = fromPlainText(input.draftText);
  await db.insert(proposalSectionSnapshots).values({
    organizationId: input.organizationId,
    proposalSectionId: input.sectionId,
    proposalId: input.proposalId,
    kind: "ai_draft",
    label: AI_DRAFT_SNAPSHOT_LABEL,
    bodyDoc,
    wordCount: countWords(bodyDoc),
    createdByUserId: input.requestedByUserId,
    createdByNameSnapshot: "FORGE AI",
  });
}

/** Each section's newest AI draft and its text now, for one proposal of this organization. */
async function loadDraftsAndText(organizationId: string, proposalId: string) {
  const snapshots = await db
    .select({ sectionId: proposalSectionSnapshots.proposalSectionId, bodyDoc: proposalSectionSnapshots.bodyDoc })
    .from(proposalSectionSnapshots)
    .where(
      and(
        eq(proposalSectionSnapshots.organizationId, organizationId),
        eq(proposalSectionSnapshots.proposalId, proposalId),
        eq(proposalSectionSnapshots.kind, "ai_draft"),
      ),
    )
    .orderBy(desc(proposalSectionSnapshots.createdAt));
  const drafts = latestPerSection(snapshots);
  if (drafts.length === 0) return [];

  const sections = await db
    .select({ id: proposalSections.id, kind: proposalSections.kind, bodyDoc: proposalSections.bodyDoc, content: proposalSections.content })
    .from(proposalSections)
    .innerJoin(proposals, eq(proposals.id, proposalSections.proposalId))
    .where(and(eq(proposalSections.proposalId, proposalId), eq(proposals.organizationId, organizationId)));
  const byId = new Map(sections.map((s) => [s.id, s]));

  return drafts.flatMap((draft) => {
    const section = byId.get(draft.sectionId);
    if (!section) return [];
    const doc = validateDoc(section.bodyDoc) as TipTapDoc | null;
    return [
      {
        sectionId: draft.sectionId,
        sectionKind: section.kind as string,
        draftText: projectToPlain(draft.bodyDoc),
        currentText: doc ? projectToPlain(doc) : (section.content ?? ""),
      },
    ];
  });
}

/**
 * A review round is starting: record, per section with an AI draft, the
 * share of that draft still in the text. Once per (round, section); a
 * second call writes nothing. Returns the number of sections measured.
 */
export async function measureRetentionAtReview(input: {
  organizationId: string;
  proposalId: string;
  reviewId: string;
}): Promise<number> {
  const [review] = await db
    .select({ id: proposalReviews.id, color: proposalReviews.color })
    .from(proposalReviews)
    .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
    .where(
      and(
        eq(proposalReviews.id, input.reviewId),
        eq(proposalReviews.proposalId, input.proposalId),
        eq(proposals.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!review) return 0;

  const inputs = await loadDraftsAndText(input.organizationId, input.proposalId);
  const kindById = new Map(inputs.map((i) => [i.sectionId, i.sectionKind]));
  const measured = measureRetention(inputs);
  if (measured.length === 0) return 0;

  const written = await db
    .insert(sectionDraftRetentions)
    .values(
      measured.map((m) => ({
        organizationId: input.organizationId,
        proposalId: input.proposalId,
        sectionId: m.sectionId,
        reviewId: review.id,
        reviewColor: review.color,
        sectionKind: kindById.get(m.sectionId) ?? "",
        draftWordCount: m.draftWordCount,
        keptWordCount: m.keptWordCount,
        keptFraction: m.keptFraction,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: sectionDraftRetentions.id });
  return written.length;
}

export type DraftRetention = {
  /** One line per review round that measured something, oldest first. */
  reviews: ReviewRetention[];
  /** The share of the AI drafts in the text right now; null when no section has an AI draft. */
  now: { sections: number; keptShare: number | null } | null;
};

export async function loadDraftRetention(input: { organizationId: string; proposalId: string }): Promise<DraftRetention> {
  const rows = await db
    .select({
      reviewId: sectionDraftRetentions.reviewId,
      reviewColor: sectionDraftRetentions.reviewColor,
      startedAt: proposalReviews.startedAt,
      draftWordCount: sectionDraftRetentions.draftWordCount,
      keptWordCount: sectionDraftRetentions.keptWordCount,
    })
    .from(sectionDraftRetentions)
    .innerJoin(proposalReviews, eq(proposalReviews.id, sectionDraftRetentions.reviewId))
    .where(
      and(
        eq(sectionDraftRetentions.organizationId, input.organizationId),
        eq(sectionDraftRetentions.proposalId, input.proposalId),
      ),
    );
  const measured = measureRetention(await loadDraftsAndText(input.organizationId, input.proposalId));
  return {
    reviews: retentionByReview(rows.map((r) => ({ ...r, startedAt: r.startedAt ? r.startedAt.toISOString() : null }))),
    now: measured.length > 0 ? { sections: measured.length, keptShare: keptShare(measured) } : null,
  };
}

/**
 * For the authors of some tracked changes on a proposal: the newest
 * started round (in progress or complete) each was a reviewer on.
 * Authors who reviewed nothing are absent from the map.
 */
export async function reviewRoundsForAuthors(input: {
  organizationId: string;
  proposalId: string;
  authorIds: string[];
}): Promise<Map<string, { reviewId: string; color: string }>> {
  const authorIds = [...new Set(input.authorIds.filter(Boolean))];
  if (authorIds.length === 0) return new Map();
  const rows = await db
    .select({ userId: proposalReviewAssignments.userId, reviewId: proposalReviews.id, color: proposalReviews.color })
    .from(proposalReviewAssignments)
    .innerJoin(proposalReviews, eq(proposalReviews.id, proposalReviewAssignments.reviewId))
    .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
    .where(
      and(
        eq(proposals.organizationId, input.organizationId),
        eq(proposalReviews.proposalId, input.proposalId),
        inArray(proposalReviews.status, ["in_progress", "complete"]),
        inArray(proposalReviewAssignments.userId, authorIds),
      ),
    )
    .orderBy(desc(proposalReviews.startedAt), desc(proposalReviews.createdAt));
  return roundByReviewer(rows);
}
