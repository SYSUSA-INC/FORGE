import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  opportunities,
  proposalReviews,
  proposals,
  users,
  type OpportunityStage,
  type ProposalStage,
} from "@/db/schema";
import {
  buildStageStats,
  type StageStat,
} from "@/app/(app)/opportunities/stage-stats";

/**
 * Single source of truth for the cross-page aggregates that both
 * `/` (Command Center) and `/opportunities` (Opportunities Dashboard)
 * render. Per BL-7 the spec requires "All this information MUST roll
 * up to the command center dashboard and to the Opportunities
 * dashboard. The data has to sync across."
 *
 * Computing once here means:
 *   - The same numbers appear on both pages, always
 *   - Adding a new aggregate (e.g. weighted-by-PWin value) lands in
 *     one file instead of two
 *   - revalidatePath('/') + revalidatePath('/opportunities') on
 *     mutations is sufficient to refresh both views
 */

export type OpportunityStageStats = Record<string, StageStat>;

export type SnapshotOpportunityRow = {
  id: string;
  title: string;
  agency: string;
  stage: OpportunityStage;
  solicitationNumber: string;
  valueLow: string;
  valueHigh: string;
  responseDueDate: Date | null;
  pWin: number;
  ownerUserId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  updatedAt: Date;
};

export type OrganizationSnapshot = {
  /** Per-stage count + due-date proximity. Keyed by OpportunityStage. */
  oppStageStats: OpportunityStageStats;

  /** All opportunities in the org, joined with owner. The dashboard
   *  renders these as the list below the widget grid. The Command
   *  Center reads only the stage stats and ignores rows. */
  oppRows: SnapshotOpportunityRow[];

  /** Active proposals only (draft / pink / red / gold / white_gloves
   *  / submitted). Used by Command Center "Recent proposals" panel. */
  activeProposalRows: {
    id: string;
    title: string;
    stage: ProposalStage;
    updatedAt: Date;
  }[];

  /** Count of proposal_reviews currently in_progress in the org. */
  proposalsInReview: number;

  /** The single most-pressing opportunity by future due date, or null
   *  if every active opp has no due date or all are past due. */
  nextDue: {
    id: string;
    title: string;
    agency: string;
    stage: OpportunityStage;
    responseDueDate: Date;
    pWin: number;
    daysToDue: number;
  } | null;
};

const ACTIVE_PROPOSAL_STAGES: ProposalStage[] = [
  "draft",
  "pink_team",
  "red_team",
  "gold_team",
  "white_gloves",
  "submitted",
];

/**
 * Build a complete snapshot for an organization in one pass. Three
 * parallel queries (opportunities, proposals, in-progress reviews)
 * with everything else derived in memory.
 */
export async function getOrganizationSnapshot(
  organizationId: string,
): Promise<OrganizationSnapshot> {
  const [oppRows, propRows, reviewCount] = await Promise.all([
    db
      .select({
        id: opportunities.id,
        title: opportunities.title,
        agency: opportunities.agency,
        stage: opportunities.stage,
        solicitationNumber: opportunities.solicitationNumber,
        valueLow: opportunities.valueLow,
        valueHigh: opportunities.valueHigh,
        responseDueDate: opportunities.responseDueDate,
        pWin: opportunities.pWin,
        ownerUserId: opportunities.ownerUserId,
        ownerName: users.name,
        ownerEmail: users.email,
        updatedAt: opportunities.updatedAt,
      })
      .from(opportunities)
      .leftJoin(users, eq(users.id, opportunities.ownerUserId))
      .where(eq(opportunities.organizationId, organizationId))
      .orderBy(desc(opportunities.updatedAt)),
    db
      .select({
        id: proposals.id,
        title: proposals.title,
        stage: proposals.stage,
        updatedAt: proposals.updatedAt,
      })
      .from(proposals)
      .where(
        and(
          eq(proposals.organizationId, organizationId),
          inArray(proposals.stage, ACTIVE_PROPOSAL_STAGES),
        ),
      )
      .orderBy(desc(proposals.updatedAt)),
    db
      .select({ id: proposalReviews.id })
      .from(proposalReviews)
      .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
      .where(
        and(
          eq(proposals.organizationId, organizationId),
          eq(proposalReviews.status, "in_progress"),
        ),
      ),
  ]);

  const oppStageStats = buildStageStats(oppRows);

  // Find the next due opportunity: smallest positive days-to-due
  // among non-closed stages.
  const now = Date.now();
  let nextDue: OrganizationSnapshot["nextDue"] = null;
  let nextDueMs = Infinity;
  for (const o of oppRows) {
    if (o.stage === "won" || o.stage === "lost" || o.stage === "no_bid") {
      continue;
    }
    if (!o.responseDueDate) continue;
    const dueMs = o.responseDueDate.getTime();
    if (dueMs < now) continue;
    if (dueMs >= nextDueMs) continue;
    nextDueMs = dueMs;
    nextDue = {
      id: o.id,
      title: o.title,
      agency: o.agency,
      stage: o.stage,
      responseDueDate: o.responseDueDate,
      pWin: o.pWin,
      daysToDue: Math.max(
        0,
        Math.ceil((dueMs - now) / (24 * 60 * 60 * 1000)),
      ),
    };
  }

  return {
    oppStageStats,
    oppRows,
    activeProposalRows: propRows,
    proposalsInReview: reviewCount.length,
    nextDue,
  };
}
