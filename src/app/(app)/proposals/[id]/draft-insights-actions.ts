"use server";

import { and, avg, count, eq, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { sectionChangeDecisions, sectionDraftSignals } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";

// BL-11 — per-proposal AI draft quality stats.
// Groups resolved signals by section_kind and computes the average
// accepted fraction (how much of each AI draft the user retained).
// BL-9 Slice 7 — plus the track-changes decisions recorded for the
// proposal, so the panel shows how the team resolves suggestions.

export type DraftKindStat = {
  sectionKind: string;
  draftCount: number;
  avgAcceptedFraction: number | null;
};

export type EditDecisionStats = {
  total: number;
  /** Accepted insertions ÷ resolved insertions; null with none. */
  insertAcceptRate: number | null;
  /** Accepted deletions ÷ resolved deletions; null with none. */
  deleteAcceptRate: number | null;
};

export type DraftInsights = {
  kindStats: DraftKindStat[];
  totalDrafts: number;
  resolvedDrafts: number;
  overallAvgFraction: number | null;
  abComparisonCount: number;
  abVariantBWinRate: number | null;
  editDecisions: EditDecisionStats;
};

export async function getDraftInsightsAction(
  proposalId: string,
): Promise<{ ok: true; data: DraftInsights } | { ok: false; error: string }> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  try {
    // Per-kind stats (only resolved rows so the fraction is meaningful)
    const kindRows = await db
      .select({
        sectionKind: sectionDraftSignals.sectionKind,
        draftCount: count(sectionDraftSignals.id),
        avgAcceptedFraction: avg(sectionDraftSignals.acceptedFraction),
      })
      .from(sectionDraftSignals)
      .where(
        and(
          eq(sectionDraftSignals.proposalId, proposalId),
          eq(sectionDraftSignals.organizationId, organizationId),
          isNotNull(sectionDraftSignals.acceptedFraction),
          // exclude draft_alt rows from per-kind stats (they are A/B artefacts)
          ne(sectionDraftSignals.mode, "draft_alt"),
        ),
      )
      .groupBy(sectionDraftSignals.sectionKind);

    const [totals] = await db
      .select({
        total: count(sectionDraftSignals.id),
        resolved: count(sectionDraftSignals.resolvedAt),
        overallAvg: avg(sectionDraftSignals.acceptedFraction),
      })
      .from(sectionDraftSignals)
      .where(
        and(
          eq(sectionDraftSignals.proposalId, proposalId),
          eq(sectionDraftSignals.organizationId, organizationId),
          ne(sectionDraftSignals.mode, "draft_alt"),
        ),
      );

    // A/B stats: count distinct ab_pair_ids + how often variant B won
    const abRows = await db
      .select({
        abVariant: sectionDraftSignals.abVariant,
        wins: count(sectionDraftSignals.id),
      })
      .from(sectionDraftSignals)
      .where(
        and(
          eq(sectionDraftSignals.proposalId, proposalId),
          eq(sectionDraftSignals.organizationId, organizationId),
          isNotNull(sectionDraftSignals.abPairId),
          eq(sectionDraftSignals.selected, true),
        ),
      )
      .groupBy(sectionDraftSignals.abVariant);

    const abAWins = abRows.find((r) => r.abVariant === "a")?.wins ?? 0;
    const abBWins = abRows.find((r) => r.abVariant === "b")?.wins ?? 0;
    const abTotal = Number(abAWins) + Number(abBWins);
    const abComparisonCount = abTotal;
    const abVariantBWinRate =
      abTotal > 0 ? Number(abBWins) / abTotal : null;

    // BL-9 Slice 7 — track-changes decisions, grouped by (type, decision).
    const decisionRows = await db
      .select({
        changeType: sectionChangeDecisions.changeType,
        decision: sectionChangeDecisions.decision,
        n: count(sectionChangeDecisions.id),
      })
      .from(sectionChangeDecisions)
      .where(
        and(
          eq(sectionChangeDecisions.proposalId, proposalId),
          eq(sectionChangeDecisions.organizationId, organizationId),
        ),
      )
      .groupBy(sectionChangeDecisions.changeType, sectionChangeDecisions.decision);
    const tally = (type: string, decision: string) =>
      Number(decisionRows.find((r) => r.changeType === type && r.decision === decision)?.n ?? 0);
    const insertsTotal = tally("insert", "accept") + tally("insert", "reject");
    const deletesTotal = tally("delete", "accept") + tally("delete", "reject");
    const editDecisions: EditDecisionStats = {
      total: insertsTotal + deletesTotal,
      insertAcceptRate: insertsTotal > 0 ? tally("insert", "accept") / insertsTotal : null,
      deleteAcceptRate: deletesTotal > 0 ? tally("delete", "accept") / deletesTotal : null,
    };

    return {
      ok: true,
      data: {
        kindStats: kindRows.map((r) => ({
          sectionKind: r.sectionKind,
          draftCount: Number(r.draftCount),
          avgAcceptedFraction:
            r.avgAcceptedFraction != null
              ? Number(r.avgAcceptedFraction)
              : null,
        })),
        totalDrafts: Number(totals?.total ?? 0),
        resolvedDrafts: Number(totals?.resolved ?? 0),
        overallAvgFraction:
          totals?.overallAvg != null ? Number(totals.overallAvg) : null,
        abComparisonCount,
        abVariantBWinRate,
        editDecisions,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to load insights.",
    };
  }
}
