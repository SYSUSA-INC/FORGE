/**
 * BL-AIP-6 — the signals the writer's AI reads that it never read before.
 *
 * Four learning loops already write rows nobody fed back into the
 * drafter or the chat:
 *   - section_draft_signal: how much of each AI draft survived the save
 *   - proposal_review_comment: what colour-team reviewers actually said
 *     about this section
 *   - proposal_debrief: the weaknesses the agency cited after a loss
 *   - proposal_winner_analysis: the gaps the AI judged cost us a bid
 *
 * This module loads them, best-effort, scoped by organizationId, and
 * hands back a compact shape the prompts can render. Server-only.
 */
import "server-only";

import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  opportunities,
  proposalDebriefs,
  proposalReviewComments,
  proposalReviews,
  proposalWinnerAnalyses,
  proposals,
  sectionDraftSignals,
} from "@/db/schema";
import { log } from "@/lib/log";

import type { WritingSignalsSnapshot } from "@/lib/ai-prompts";

export type WritingSignals = WritingSignalsSnapshot;

const WINDOW_DAYS = 365;
const DRAFT_MIN_SAMPLE = 3;
const MAX_COMMENTS = 8;
const MAX_DEBRIEFS = 3;
const MAX_WINNER = 2;
const CLIP = 500;

export async function gatherWritingSignals(input: {
  organizationId: string;
  proposalId: string;
  sectionId: string;
  sectionKind: string;
  agency: string;
}): Promise<WritingSignals> {
  const [draftAcceptance, reviewComments, debriefWeaknesses, winnerGaps] = await Promise.all([
    loadDraftAcceptance(input.organizationId, input.sectionKind),
    loadReviewComments(input.organizationId, input.proposalId, input.sectionId),
    loadDebriefWeaknesses(input.organizationId, input.agency),
    loadWinnerGaps(input.organizationId, input.agency),
  ]);
  return { draftAcceptance, reviewComments, debriefWeaknesses, winnerGaps };
}

async function loadDraftAcceptance(
  organizationId: string,
  sectionKind: string,
): Promise<WritingSignals["draftAcceptance"]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  try {
    const query = (kind?: string) =>
      db
        .select({
          drafts: sql<number>`count(*)`,
          mean: sql<number | null>`avg(${sectionDraftSignals.acceptedFraction})`,
        })
        .from(sectionDraftSignals)
        .where(
          and(
            eq(sectionDraftSignals.organizationId, organizationId),
            isNotNull(sectionDraftSignals.acceptedFraction),
            eq(sectionDraftSignals.stubbed, false),
            gte(sectionDraftSignals.createdAt, since),
            kind ? eq(sectionDraftSignals.sectionKind, kind) : undefined,
          ),
        );
    const [byKind] = await query(sectionKind);
    if (byKind && Number(byKind.drafts) >= DRAFT_MIN_SAMPLE && byKind.mean !== null) {
      return { drafts: Number(byKind.drafts), meanAcceptedFraction: Number(byKind.mean), widened: false };
    }
    const [all] = await query();
    if (all && Number(all.drafts) >= DRAFT_MIN_SAMPLE && all.mean !== null) {
      return { drafts: Number(all.drafts), meanAcceptedFraction: Number(all.mean), widened: true };
    }
    return null;
  } catch (err) {
    log.warn("[writing-signals]", "draft acceptance load failed", { error: err });
    return null;
  }
}

async function loadReviewComments(
  organizationId: string,
  proposalId: string,
  sectionId: string,
): Promise<WritingSignals["reviewComments"]> {
  try {
    const rows = await db
      .select({
        color: proposalReviews.color,
        body: proposalReviewComments.body,
        userId: proposalReviewComments.userId,
      })
      .from(proposalReviewComments)
      .innerJoin(proposalReviews, eq(proposalReviews.id, proposalReviewComments.reviewId))
      .innerJoin(proposals, eq(proposals.id, proposalReviews.proposalId))
      .where(
        and(
          eq(proposals.organizationId, organizationId),
          eq(proposalReviews.proposalId, proposalId),
          eq(proposalReviewComments.sectionId, sectionId),
          eq(proposalReviewComments.resolved, false),
        ),
      )
      .orderBy(desc(proposalReviewComments.createdAt))
      .limit(MAX_COMMENTS);
    return rows.map((r) => ({
      color: r.color,
      body: r.body.replace(/\s+/g, " ").trim().slice(0, CLIP),
      reviewer: r.userId ? null : "FORGE AI",
    }));
  } catch (err) {
    log.warn("[writing-signals]", "review comments load failed", { error: err });
    return [];
  }
}

async function loadDebriefWeaknesses(
  organizationId: string,
  agency: string,
): Promise<WritingSignals["debriefWeaknesses"]> {
  try {
    const rows = await db
      .select({
        agency: opportunities.agency,
        weaknesses: proposalDebriefs.weaknesses,
        improvements: proposalDebriefs.improvements,
        updatedAt: proposalDebriefs.updatedAt,
      })
      .from(proposalDebriefs)
      .innerJoin(proposals, eq(proposals.id, proposalDebriefs.proposalId))
      .innerJoin(opportunities, eq(opportunities.id, proposals.opportunityId))
      .where(
        and(
          eq(proposalDebriefs.organizationId, organizationId),
          sql`length(${proposalDebriefs.weaknesses}) > 0`,
        ),
      )
      .orderBy(desc(proposalDebriefs.updatedAt))
      .limit(12);
    const same = rows.filter((r) => agency && r.agency && r.agency.toLowerCase() === agency.toLowerCase());
    const others = rows.filter((r) => !same.includes(r));
    return [...same, ...others].slice(0, MAX_DEBRIEFS).map((r) => ({
      agency: r.agency ?? "",
      weaknesses: r.weaknesses.replace(/\s+/g, " ").trim().slice(0, CLIP),
      improvements: r.improvements.replace(/\s+/g, " ").trim().slice(0, CLIP),
    }));
  } catch (err) {
    log.warn("[writing-signals]", "debrief load failed", { error: err });
    return [];
  }
}

async function loadWinnerGaps(
  organizationId: string,
  agency: string,
): Promise<WritingSignals["winnerGaps"]> {
  try {
    const rows = await db
      .select({
        competitor: proposalWinnerAnalyses.competitorName,
        agency: opportunities.agency,
        gaps: proposalWinnerAnalyses.gapsWeHad,
        recommendations: proposalWinnerAnalyses.recommendations,
        stubbed: proposalWinnerAnalyses.stubbed,
      })
      .from(proposalWinnerAnalyses)
      .innerJoin(proposals, eq(proposals.id, proposalWinnerAnalyses.proposalId))
      .innerJoin(opportunities, eq(opportunities.id, proposals.opportunityId))
      .where(
        and(
          eq(proposalWinnerAnalyses.organizationId, organizationId),
          eq(proposalWinnerAnalyses.stubbed, false),
          sql`length(${proposalWinnerAnalyses.gapsWeHad}) > 0`,
        ),
      )
      .orderBy(desc(proposalWinnerAnalyses.updatedAt))
      .limit(8);
    const same = rows.filter((r) => agency && r.agency && r.agency.toLowerCase() === agency.toLowerCase());
    const others = rows.filter((r) => !same.includes(r));
    return [...same, ...others].slice(0, MAX_WINNER).map((r) => ({
      competitor: r.competitor,
      agency: r.agency ?? "",
      gaps: r.gaps.replace(/\s+/g, " ").trim().slice(0, CLIP),
      recommendations: r.recommendations.replace(/\s+/g, " ").trim().slice(0, CLIP),
    }));
  } catch (err) {
    log.warn("[writing-signals]", "winner analysis load failed", { error: err });
    return [];
  }
}

/** Compact prose block for the chat context (the drafter gets the JSON). */
export function renderWritingSignals(s: WritingSignals): string {
  const parts: string[] = [];
  if (s.draftAcceptance) {
    parts.push(
      `AI draft acceptance for this team${s.draftAcceptance.widened ? " (all section kinds)" : ""}: ${Math.round(
        s.draftAcceptance.meanAcceptedFraction * 100,
      )}% of AI words survive the owner's save across ${s.draftAcceptance.drafts} drafts.`,
    );
  }
  if (s.reviewComments.length > 0) {
    parts.push(
      `Open reviewer comments on this section:\n${s.reviewComments
        .map((c, i) => `  ${i + 1}. [${c.color}${c.reviewer ? ` · ${c.reviewer}` : ""}] ${c.body}`)
        .join("\n")}`,
    );
  }
  if (s.debriefWeaknesses.length > 0) {
    parts.push(
      `Weaknesses the agency cited in past debriefs (avoid repeating them):\n${s.debriefWeaknesses
        .map((d, i) => `  ${i + 1}. ${d.agency || "agency"}: ${d.weaknesses}${d.improvements ? ` — improve: ${d.improvements}` : ""}`)
        .join("\n")}`,
    );
  }
  if (s.winnerGaps.length > 0) {
    parts.push(
      `Gaps found against past winners:\n${s.winnerGaps
        .map((w, i) => `  ${i + 1}. vs ${w.competitor || "winner"} (${w.agency || "agency"}): ${w.gaps}${w.recommendations ? ` — do: ${w.recommendations}` : ""}`)
        .join("\n")}`,
    );
  }
  return parts.join("\n\n");
}
