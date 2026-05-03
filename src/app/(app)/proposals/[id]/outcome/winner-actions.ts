"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  opportunities,
  proposalDebriefs,
  proposalOutcomes,
  proposalSections,
  proposalWinnerAnalyses,
  proposals,
  type TipTapDoc,
} from "@/db/schema";
import { complete } from "@/lib/ai";
import {
  buildWinnerAnalysisPrompt,
  type WinnerAnalysisVerdict,
} from "@/lib/ai-prompts";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { enforceRateLimit } from "@/lib/rate-limit";
import { projectToPlain } from "@/lib/tiptap-doc";
import { searchAwardsByRecipientName } from "@/lib/usaspending";

export type WinnerAnalysisRow = {
  competitorName: string;
  winnerProfileSummary: string;
  gapsWeHad: string;
  ourStrengthsUnrecognized: string;
  recommendations: string;
  sourceUsaspending: NonNullable<
    typeof proposalWinnerAnalyses.$inferSelect.sourceUsaspending
  >;
  model: string;
  stubbed: boolean;
  updatedAt: string;
};

export type GetWinnerAnalysisResult =
  | { ok: true; analysis: WinnerAnalysisRow | null }
  | { ok: false; error: string };

export async function getWinnerAnalysisAction(
  proposalId: string,
): Promise<GetWinnerAnalysisResult> {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const [row] = await db
    .select()
    .from(proposalWinnerAnalyses)
    .where(
      and(
        eq(proposalWinnerAnalyses.proposalId, proposalId),
        eq(proposalWinnerAnalyses.organizationId, organizationId),
      ),
    )
    .limit(1);
  return {
    ok: true,
    analysis: row
      ? {
          competitorName: row.competitorName,
          winnerProfileSummary: row.winnerProfileSummary,
          gapsWeHad: row.gapsWeHad,
          ourStrengthsUnrecognized: row.ourStrengthsUnrecognized,
          recommendations: row.recommendations,
          sourceUsaspending: row.sourceUsaspending ?? [],
          model: row.model,
          stubbed: row.stubbed,
          updatedAt: row.updatedAt.toISOString(),
        }
      : null,
  };
}

export type RunWinnerAnalysisResult =
  | {
      ok: true;
      analysis: WinnerAnalysisRow;
      competitorAwardsFound: number;
    }
  | { ok: false; error: string };

/**
 * Phase 14f — proposal-vs-winner analysis.
 *
 * Pre-conditions: proposal outcome must be 'lost' or 'no_bid' (the
 * 'who won' question only makes sense post-loss) AND
 * awardedToCompetitor must be set on the outcome row.
 *
 * Flow:
 *   1. Load proposal + outcome + optional debrief.
 *   2. Pull our submitted section bodies, project to plain text.
 *   3. Search USAspending for the competitor's recent awards.
 *   4. Send everything to the AI with the WINNER_ANALYSIS prompt.
 *   5. Validate JSON, write the analysis row (UPSERT).
 *
 * Idempotent — re-runs UPDATE the existing row.
 */
export async function runWinnerAnalysisAction(
  proposalId: string,
): Promise<RunWinnerAnalysisResult> {
  const user = await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  // Rate limit: winner analysis is expensive (USAspending fetch + AI).
  // 5 runs/hour per proposal is plenty for normal iteration.
  const limit = await enforceRateLimit({
    key: `winner-analysis:proposal:${proposalId}`,
    limit: 5,
    windowSeconds: 3600,
  });
  if (!limit.ok) {
    return {
      ok: false,
      error: `Winner analysis limit (5/hour) reached for this proposal. Retry in ${Math.ceil(limit.retryAfter / 60)} min.`,
    };
  }

  // Verify ownership + load proposal + opportunity context.
  const [propRow] = await db
    .select({
      proposal: proposals,
      agency: opportunities.agency,
      solicitationNumber: opportunities.solicitationNumber,
      naicsCode: opportunities.naicsCode,
      setAside: opportunities.setAside,
    })
    .from(proposals)
    .innerJoin(opportunities, eq(opportunities.id, proposals.opportunityId))
    .where(
      and(
        eq(proposals.id, proposalId),
        eq(proposals.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!propRow) return { ok: false, error: "Proposal not found." };

  const [outcome] = await db
    .select()
    .from(proposalOutcomes)
    .where(eq(proposalOutcomes.proposalId, proposalId))
    .limit(1);
  if (!outcome) {
    return {
      ok: false,
      error:
        "Record an outcome first — winner analysis requires the loss to be on file.",
    };
  }
  if (outcome.outcomeType !== "lost") {
    return {
      ok: false,
      error: "Winner analysis only runs on lost proposals.",
    };
  }
  const competitorName = (outcome.awardedToCompetitor ?? "").trim();
  if (!competitorName) {
    return {
      ok: false,
      error:
        "Set 'Awarded to' on the outcome (the winning competitor's name) before running.",
    };
  }

  // Optional debrief.
  const [debrief] = await db
    .select()
    .from(proposalDebriefs)
    .where(eq(proposalDebriefs.proposalId, proposalId))
    .limit(1);

  // Our submission summary — section title + first 800 chars of plain
  // body, in section order.
  const sections = await db
    .select({
      title: proposalSections.title,
      kind: proposalSections.kind,
      ordering: proposalSections.ordering,
      bodyDoc: proposalSections.bodyDoc,
      content: proposalSections.content,
    })
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, proposalId))
    .orderBy(asc(proposalSections.ordering));

  const ourSubmissionSummary = sections
    .map((s) => {
      const plain = (
        projectToPlain(s.bodyDoc as TipTapDoc | null) ||
        s.content ||
        ""
      ).slice(0, 800);
      return `## ${s.ordering}. ${s.title} (${s.kind})\n${plain || "(empty)"}`;
    })
    .join("\n\n")
    .slice(0, 12000);

  // Pull USAspending profile for the competitor. Best effort — no
  // matches still produces a usable analysis.
  let competitorAwards: NonNullable<
    typeof proposalWinnerAnalyses.$inferSelect.sourceUsaspending
  > = [];
  try {
    const r = await searchAwardsByRecipientName(competitorName, {
      limit: 8,
      includeIdv: true,
    });
    if (r.ok) {
      competitorAwards = r.awards.slice(0, 8).map((a) => ({
        piid: a.awardId,
        agency:
          a.awardingSubAgency || a.awardingAgency || "(unknown agency)",
        value: a.amount > 0 ? `$${Math.round(a.amount).toLocaleString()}` : "",
        periodStart: a.startDate ?? "",
        periodEnd: a.endDate ?? "",
        description: (a.description ?? "").slice(0, 600),
      }));
    }
  } catch (err) {
    console.warn("[winner-analysis] usaspending failed", err);
  }

  // AI call.
  const prompt = buildWinnerAnalysisPrompt({
    proposalTitle: propRow.proposal.title,
    agency: propRow.agency ?? "",
    solicitationNumber: propRow.solicitationNumber ?? "",
    naicsCode: propRow.naicsCode ?? "",
    setAside: propRow.setAside ?? "",
    ourSubmissionSummary,
    outcome: {
      awardValue: outcome.awardValue ?? "",
      decisionDate: outcome.decisionDate
        ? outcome.decisionDate.toISOString().slice(0, 10)
        : "",
      summary: outcome.summary ?? "",
      lessonsLearned: outcome.lessonsLearned ?? "",
      awardedToCompetitor: competitorName,
    },
    debrief: debrief
      ? {
          strengths: debrief.strengths ?? "",
          weaknesses: debrief.weaknesses ?? "",
          improvements: debrief.improvements ?? "",
          pastPerformanceCitation: debrief.pastPerformanceCitation ?? "",
          notes: debrief.notes ?? "",
        }
      : null,
    competitorAwards,
  });

  let raw = "";
  let model = "stub";
  let stubbed = true;
  try {
    const res = await complete({
      system: prompt.system,
      messages: prompt.messages,
      maxTokens: 2400,
      temperature: 0.2,
      cacheSystem: true,
    });
    raw = res.text;
    model = `${res.provider}:${res.model}`;
    stubbed = res.stubbed;
  } catch (err) {
    console.error("[winner-analysis] AI call failed", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "AI call failed.",
    };
  }

  let parsed: Partial<WinnerAnalysisVerdict> = {};
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (err) {
    console.warn("[winner-analysis] JSON parse failed", err, raw.slice(0, 240));
    return {
      ok: false,
      error: "AI response wasn't valid JSON. Re-run, or check the API key.",
    };
  }

  const cap = (s: unknown, n = 1200) =>
    typeof s === "string" ? s.slice(0, n) : "";

  const analysisValues = {
    organizationId,
    proposalId,
    competitorName,
    winnerProfileSummary: cap(parsed.winnerProfileSummary),
    gapsWeHad: cap(parsed.gapsWeHad),
    ourStrengthsUnrecognized: cap(parsed.ourStrengthsUnrecognized),
    recommendations: cap(parsed.recommendations),
    sourceUsaspending: competitorAwards,
    model,
    stubbed,
    createdByUserId: user.id,
    updatedAt: new Date(),
  };

  // Sequential upsert per Neon-pgbouncer rule.
  const [existing] = await db
    .select({ id: proposalWinnerAnalyses.id })
    .from(proposalWinnerAnalyses)
    .where(eq(proposalWinnerAnalyses.proposalId, proposalId))
    .limit(1);

  if (existing) {
    const { createdByUserId: _ignored, ...update } = analysisValues;
    void _ignored;
    await db
      .update(proposalWinnerAnalyses)
      .set(update)
      .where(eq(proposalWinnerAnalyses.id, existing.id));
  } else {
    await db.insert(proposalWinnerAnalyses).values(analysisValues);
  }

  revalidatePath(`/proposals/${proposalId}/outcome`);

  return {
    ok: true,
    competitorAwardsFound: competitorAwards.length,
    analysis: {
      competitorName,
      winnerProfileSummary: analysisValues.winnerProfileSummary,
      gapsWeHad: analysisValues.gapsWeHad,
      ourStrengthsUnrecognized: analysisValues.ourStrengthsUnrecognized,
      recommendations: analysisValues.recommendations,
      sourceUsaspending: competitorAwards,
      model,
      stubbed,
      updatedAt: analysisValues.updatedAt.toISOString(),
    },
  };
}

function extractJson(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return raw;
  return raw.slice(start, end + 1);
}
