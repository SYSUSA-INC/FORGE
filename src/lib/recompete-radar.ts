/**
 * BL-FB-WIN-RECOMPETE — server side: load an org's decided pursuits with
 * their outcome, debrief and winner analysis, then run the radar against
 * a solicitation, an opportunity, a page of SAM.gov results, or the
 * org's open work for the dashboard. Every query is scoped by the
 * caller-supplied organizationId.
 */
import "server-only";

import { and, desc, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  opportunities,
  proposalDebriefs,
  proposalOutcomes,
  proposalWinnerAnalyses,
  proposals,
  solicitations,
} from "@/db/schema";
import { parseMoney } from "@/lib/loss-patterns";
import {
  findRecompetes,
  RECOMPETE_THRESHOLDS,
  summarizeMatch,
  type RecompeteFlag,
  type RecompeteMatch,
  type RecompetePrior,
  type RecompeteTarget,
} from "@/lib/recompete-match";
import type { SamOpportunity } from "@/lib/samgov";

const PRIOR_LIMIT = 500;
const MAX_SCOPE = RECOMPETE_THRESHOLDS.maxScopeChars;
const ATTENTION_OPEN_OPPS = 60;
const ATTENTION_RECENT_SOLS = 40;
const ATTENTION_LIMIT = 8;
const DAY_MS = 86_400_000;

function requirementsText(reqs: unknown): string {
  if (!Array.isArray(reqs)) return "";
  const texts: string[] = [];
  for (const r of reqs) {
    const t = (r as { text?: unknown })?.text;
    if (typeof t === "string" && t.trim()) texts.push(t.trim());
    if (texts.length >= 80) break;
  }
  return texts.join("\n");
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function cap(s: string): string {
  return s.length > MAX_SCOPE ? s.slice(0, MAX_SCOPE) : s;
}

/** Decided pursuits with everything the radar surfaces. */
export async function loadRecompetePriors(organizationId: string): Promise<RecompetePrior[]> {
  const rows = await db
    .select({
      proposalId: proposals.id,
      proposalTitle: proposals.title,
      opportunityId: proposals.opportunityId,
      oppTitle: opportunities.title,
      agency: opportunities.agency,
      naicsCode: opportunities.naicsCode,
      solicitationNumber: opportunities.solicitationNumber,
      noticeId: opportunities.noticeId,
      description: sql<string>`left(${opportunities.description}, ${MAX_SCOPE})`,
      outcomeType: proposalOutcomes.outcomeType,
      decisionDate: proposalOutcomes.decisionDate,
      outcomeUpdatedAt: proposalOutcomes.updatedAt,
      reasons: proposalOutcomes.reasons,
      awardedTo: proposalOutcomes.awardedToCompetitor,
      awardValue: proposalOutcomes.awardValue,
      lessonsLearned: proposalOutcomes.lessonsLearned,
      debriefStrengths: proposalDebriefs.strengths,
      debriefWeaknesses: proposalDebriefs.weaknesses,
      debriefImprovements: proposalDebriefs.improvements,
      waCompetitor: proposalWinnerAnalyses.competitorName,
      waGaps: proposalWinnerAnalyses.gapsWeHad,
      waRecommendations: proposalWinnerAnalyses.recommendations,
    })
    .from(proposalOutcomes)
    .innerJoin(proposals, eq(proposals.id, proposalOutcomes.proposalId))
    .innerJoin(opportunities, eq(opportunities.id, proposals.opportunityId))
    .leftJoin(proposalDebriefs, eq(proposalDebriefs.proposalId, proposals.id))
    .leftJoin(proposalWinnerAnalyses, eq(proposalWinnerAnalyses.proposalId, proposals.id))
    .where(
      and(
        eq(proposalOutcomes.organizationId, organizationId),
        inArray(proposalOutcomes.outcomeType, ["won", "lost"]),
      ),
    )
    .orderBy(desc(proposalOutcomes.updatedAt))
    .limit(PRIOR_LIMIT);

  // Richer scope from the solicitation that was converted into each
  // opportunity, when there is one.
  const oppIds = [...new Set(rows.map((r) => r.opportunityId))];
  const scopeByOpp = new Map<string, string>();
  if (oppIds.length > 0) {
    const sols = await db
      .select({
        opportunityId: solicitations.opportunityId,
        requirements: solicitations.extractedRequirements,
        sectionL: solicitations.sectionLSummary,
      })
      .from(solicitations)
      .where(
        and(
          eq(solicitations.organizationId, organizationId),
          inArray(solicitations.opportunityId, oppIds),
        ),
      )
      .orderBy(desc(solicitations.createdAt));
    for (const s of sols) {
      if (!s.opportunityId || scopeByOpp.has(s.opportunityId)) continue;
      const text = [requirementsText(s.requirements), s.sectionL ?? ""].filter(Boolean).join("\n");
      if (text.trim()) scopeByOpp.set(s.opportunityId, text);
    }
  }

  return rows.map((r) => {
    const decided = r.decisionDate ?? r.outcomeUpdatedAt;
    const hasDebrief = Boolean(
      (r.debriefStrengths ?? "").trim() ||
        (r.debriefWeaknesses ?? "").trim() ||
        (r.debriefImprovements ?? "").trim(),
    );
    const hasWa = Boolean((r.waGaps ?? "").trim() || (r.waRecommendations ?? "").trim());
    return {
      proposalId: r.proposalId,
      opportunityId: r.opportunityId,
      title: r.oppTitle || r.proposalTitle,
      agency: r.agency ?? "",
      naicsCode: r.naicsCode ?? "",
      solicitationNumber: r.solicitationNumber ?? "",
      noticeId: r.noticeId ?? "",
      scopeText: cap(
        [r.description ?? "", scopeByOpp.get(r.opportunityId) ?? ""].filter(Boolean).join("\n"),
      ),
      outcome: r.outcomeType === "won" ? "won" : "lost",
      decidedAt: decided ? new Date(decided).toISOString() : null,
      awardedTo: r.awardedTo ?? "",
      awardValue: parseMoney(r.awardValue),
      reasons: (r.reasons ?? []) as string[],
      lessonsLearned: r.lessonsLearned ?? "",
      debrief: hasDebrief
        ? {
            strengths: r.debriefStrengths ?? "",
            weaknesses: r.debriefWeaknesses ?? "",
            improvements: r.debriefImprovements ?? "",
          }
        : null,
      winnerAnalysis: hasWa
        ? {
            competitorName: r.waCompetitor ?? "",
            gapsWeHad: r.waGaps ?? "",
            recommendations: r.waRecommendations ?? "",
          }
        : null,
    };
  });
}

/** Matches for a solicitation, excluding its own converted pursuit. */
export async function getRecompeteForSolicitation(input: {
  organizationId: string;
  solicitationId: string;
  limit?: number;
}): Promise<RecompeteMatch[]> {
  const { organizationId } = input;
  const [s] = await db
    .select({
      id: solicitations.id,
      title: solicitations.title,
      agency: solicitations.agency,
      naicsCode: solicitations.naicsCode,
      solicitationNumber: solicitations.solicitationNumber,
      noticeId: solicitations.noticeId,
      rawText: sql<string>`left(${solicitations.rawText}, ${MAX_SCOPE})`,
      requirements: solicitations.extractedRequirements,
      sectionL: solicitations.sectionLSummary,
      opportunityId: solicitations.opportunityId,
      parentSolicitationId: solicitations.parentSolicitationId,
    })
    .from(solicitations)
    .where(
      and(eq(solicitations.id, input.solicitationId), eq(solicitations.organizationId, organizationId)),
    )
    .limit(1);
  if (!s) return [];

  // An amendment's own pursuit hangs off the parent solicitation.
  const ownOpps = new Set<string>();
  if (s.opportunityId) ownOpps.add(s.opportunityId);
  if (s.parentSolicitationId) {
    const [parent] = await db
      .select({ opportunityId: solicitations.opportunityId })
      .from(solicitations)
      .where(
        and(
          eq(solicitations.id, s.parentSolicitationId),
          eq(solicitations.organizationId, organizationId),
        ),
      )
      .limit(1);
    if (parent?.opportunityId) ownOpps.add(parent.opportunityId);
  }

  const reqText = requirementsText(s.requirements);
  const scopeText = cap(
    reqText
      ? [reqText, s.sectionL ?? ""].filter(Boolean).join("\n")
      : (s.rawText ?? ""),
  );
  const target: RecompeteTarget = {
    title: s.title ?? "",
    agency: s.agency ?? "",
    naicsCode: s.naicsCode ?? "",
    solicitationNumber: s.solicitationNumber ?? "",
    noticeId: s.noticeId ?? "",
    scopeText,
    incumbent: "",
  };

  const priors = (await loadRecompetePriors(organizationId)).filter(
    (p) => !ownOpps.has(p.opportunityId),
  );
  return findRecompetes(target, priors, input.limit ?? 3);
}

/** Matches for an opportunity, excluding itself. */
export async function getRecompeteForOpportunity(input: {
  organizationId: string;
  opportunityId: string;
  limit?: number;
}): Promise<RecompeteMatch[]> {
  const { organizationId } = input;
  const [o] = await db
    .select({
      id: opportunities.id,
      title: opportunities.title,
      agency: opportunities.agency,
      naicsCode: opportunities.naicsCode,
      solicitationNumber: opportunities.solicitationNumber,
      noticeId: opportunities.noticeId,
      description: sql<string>`left(${opportunities.description}, ${MAX_SCOPE})`,
      incumbent: opportunities.incumbent,
    })
    .from(opportunities)
    .where(and(eq(opportunities.id, input.opportunityId), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  if (!o) return [];

  const target: RecompeteTarget = {
    title: o.title,
    agency: o.agency ?? "",
    naicsCode: o.naicsCode ?? "",
    solicitationNumber: o.solicitationNumber ?? "",
    noticeId: o.noticeId ?? "",
    scopeText: cap(o.description ?? ""),
    incumbent: o.incumbent ?? "",
  };
  const priors = (await loadRecompetePriors(organizationId)).filter(
    (p) => p.opportunityId !== o.id,
  );
  return findRecompetes(target, priors, input.limit ?? 3);
}

function samTarget(o: SamOpportunity): RecompeteTarget {
  return {
    title: o.title ?? "",
    agency: [o.department, o.subTier].filter(Boolean).join(" · "),
    naicsCode: o.naicsCode ?? "",
    solicitationNumber: o.solicitationNumber ?? "",
    noticeId: o.noticeId ?? "",
    scopeText: cap(stripHtml(o.description ?? "")),
    incumbent: "",
  };
}

/**
 * Best recompete flag per SAM.gov result, keyed by notice id. Results
 * that do not match anything are absent from the map.
 */
export async function flagSamResults(
  organizationId: string,
  results: SamOpportunity[],
): Promise<Record<string, RecompeteFlag>> {
  if (results.length === 0) return {};
  const priors = await loadRecompetePriors(organizationId);
  if (priors.length === 0) return {};
  const out: Record<string, RecompeteFlag> = {};
  for (const o of results) {
    if (!o.noticeId) continue;
    const [best] = findRecompetes(samTarget(o), priors, 1);
    if (best) out[o.noticeId] = summarizeMatch(best, 200);
  }
  return out;
}

export type RecompeteAttentionItem = {
  kind: "opportunity" | "solicitation";
  id: string;
  title: string;
  agency: string;
  flag: RecompeteFlag;
};

/**
 * Open work that looks like a recompete of a decided pursuit, for the
 * Command Center "needs attention" strip. Recent open opportunities
 * first; recent solicitations that have not been converted fill in.
 */
export async function getRecompeteAttention(
  organizationId: string,
): Promise<RecompeteAttentionItem[]> {
  const priors = await loadRecompetePriors(organizationId);
  if (priors.length === 0) return [];
  const decidedOpps = new Set(priors.map((p) => p.opportunityId));
  const now = Date.now();

  const openOpps = await db
    .select({
      id: opportunities.id,
      title: opportunities.title,
      agency: opportunities.agency,
      naicsCode: opportunities.naicsCode,
      solicitationNumber: opportunities.solicitationNumber,
      noticeId: opportunities.noticeId,
      description: sql<string>`left(${opportunities.description}, ${MAX_SCOPE})`,
      incumbent: opportunities.incumbent,
    })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.organizationId, organizationId),
        notInArray(opportunities.stage, ["won", "lost", "no_bid"]),
        gte(opportunities.updatedAt, new Date(now - 180 * DAY_MS)),
      ),
    )
    .orderBy(desc(opportunities.updatedAt))
    .limit(ATTENTION_OPEN_OPPS);
  const openOppIds = new Set(openOpps.map((o) => o.id));

  const recentSols = await db
    .select({
      id: solicitations.id,
      title: solicitations.title,
      agency: solicitations.agency,
      naicsCode: solicitations.naicsCode,
      solicitationNumber: solicitations.solicitationNumber,
      noticeId: solicitations.noticeId,
      requirements: solicitations.extractedRequirements,
      sectionL: solicitations.sectionLSummary,
      opportunityId: solicitations.opportunityId,
      parentSolicitationId: solicitations.parentSolicitationId,
    })
    .from(solicitations)
    .where(
      and(
        eq(solicitations.organizationId, organizationId),
        gte(solicitations.createdAt, new Date(now - 120 * DAY_MS)),
      ),
    )
    .orderBy(desc(solicitations.createdAt))
    .limit(ATTENTION_RECENT_SOLS);

  const items: RecompeteAttentionItem[] = [];

  for (const o of openOpps) {
    if (decidedOpps.has(o.id)) continue;
    const target: RecompeteTarget = {
      title: o.title,
      agency: o.agency ?? "",
      naicsCode: o.naicsCode ?? "",
      solicitationNumber: o.solicitationNumber ?? "",
      noticeId: o.noticeId ?? "",
      scopeText: cap(o.description ?? ""),
      incumbent: o.incumbent ?? "",
    };
    const [best] = findRecompetes(target, priors.filter((p) => p.opportunityId !== o.id), 1);
    if (best) {
      items.push({
        kind: "opportunity",
        id: o.id,
        title: o.title,
        agency: o.agency ?? "",
        flag: summarizeMatch(best, 160),
      });
    }
  }

  for (const s of recentSols) {
    // Skip amendments and anything already covered by an open or
    // decided opportunity.
    if (s.parentSolicitationId) continue;
    if (s.opportunityId && (openOppIds.has(s.opportunityId) || decidedOpps.has(s.opportunityId))) {
      continue;
    }
    const reqText = requirementsText(s.requirements);
    const target: RecompeteTarget = {
      title: s.title ?? "",
      agency: s.agency ?? "",
      naicsCode: s.naicsCode ?? "",
      solicitationNumber: s.solicitationNumber ?? "",
      noticeId: s.noticeId ?? "",
      scopeText: cap([reqText, s.sectionL ?? ""].filter(Boolean).join("\n")),
      incumbent: "",
    };
    const [best] = findRecompetes(target, priors, 1);
    if (best) {
      items.push({
        kind: "solicitation",
        id: s.id,
        title: s.title || s.solicitationNumber || "Untitled solicitation",
        agency: s.agency ?? "",
        flag: summarizeMatch(best, 160),
      });
    }
  }

  items.sort((a, b) => b.flag.score - a.flag.score);
  return items.slice(0, ATTENTION_LIMIT);
}
