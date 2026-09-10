/**
 * BL-FB-WIN-CROSS-LOSS — server side: load an org's decided pursuits
 * with everything the pattern detector needs, then detect.
 *
 * Joins proposal outcomes to their proposal and opportunity, plus the
 * debrief, the winner analysis and the opportunity's tracked
 * competitors. Set-aside eligibility comes from the org's socio-economic
 * profile via the PWin model's mapping so both features agree on what
 * "eligible" means. Scoped by the caller-supplied organizationId.
 */
import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  opportunities,
  opportunityCompetitors,
  organizations,
  proposalDebriefs,
  proposalOutcomes,
  proposals,
} from "@/db/schema";
import {
  detectLossPatterns,
  parseMoney,
  type DecidedPursuit,
  type LossIntelligence,
} from "@/lib/loss-patterns";
import { setAsideEligibility, type SocioEconomic } from "@/lib/pwin-model";

const PURSUIT_LIMIT = 500;

export async function loadDecidedPursuits(organizationId: string): Promise<DecidedPursuit[]> {
  const [org] = await db
    .select({ socioEconomic: organizations.socioEconomic })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  const se = (org?.socioEconomic as SocioEconomic | null) ?? null;

  const rows = await db
    .select({
      proposalId: proposals.id,
      title: proposals.title,
      opportunityId: proposals.opportunityId,
      outcomeType: proposalOutcomes.outcomeType,
      decisionDate: proposalOutcomes.decisionDate,
      outcomeUpdatedAt: proposalOutcomes.updatedAt,
      reasons: proposalOutcomes.reasons,
      awardedTo: proposalOutcomes.awardedToCompetitor,
      awardValue: proposalOutcomes.awardValue,
      agency: opportunities.agency,
      naicsCode: opportunities.naicsCode,
      setAside: opportunities.setAside,
      valueLow: opportunities.valueLow,
      valueHigh: opportunities.valueHigh,
      debriefStatus: proposalDebriefs.status,
      debriefWeaknesses: proposalDebriefs.weaknesses,
      debriefImprovements: proposalDebriefs.improvements,
      debriefNotes: proposalDebriefs.notes,
    })
    .from(proposalOutcomes)
    .innerJoin(proposals, eq(proposals.id, proposalOutcomes.proposalId))
    .innerJoin(opportunities, eq(opportunities.id, proposals.opportunityId))
    .leftJoin(
      proposalDebriefs,
      and(
        eq(proposalDebriefs.proposalId, proposals.id),
        eq(proposalDebriefs.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(proposalOutcomes.organizationId, organizationId),
        inArray(proposalOutcomes.outcomeType, ["won", "lost"]),
      ),
    )
    .orderBy(desc(proposalOutcomes.updatedAt))
    .limit(PURSUIT_LIMIT);

  const oppIds = [...new Set(rows.map((r) => r.opportunityId))];
  const competitorsByOpp = new Map<string, string[]>();
  if (oppIds.length > 0) {
    const comps = await db
      .select({
        opportunityId: opportunityCompetitors.opportunityId,
        name: opportunityCompetitors.name,
      })
      .from(opportunityCompetitors)
      .where(inArray(opportunityCompetitors.opportunityId, oppIds));
    for (const c of comps) {
      const list = competitorsByOpp.get(c.opportunityId) ?? [];
      if (c.name.trim()) list.push(c.name.trim());
      competitorsByOpp.set(c.opportunityId, list);
    }
  }

  return rows.map((r) => {
    const low = parseMoney(r.valueLow);
    const high = parseMoney(r.valueHigh);
    const estimateMid = low && high ? (low + high) / 2 : (low ?? high);
    const decided = r.decisionDate ?? r.outcomeUpdatedAt;
    const hasDebriefNotes =
      r.debriefStatus === "held" ||
      Boolean(
        (r.debriefWeaknesses ?? "").trim() ||
          (r.debriefImprovements ?? "").trim() ||
          (r.debriefNotes ?? "").trim(),
      );
    return {
      proposalId: r.proposalId,
      title: r.title,
      outcome: r.outcomeType === "won" ? "won" : "lost",
      decidedAt: decided ? new Date(decided).toISOString() : null,
      agency: r.agency ?? "",
      naicsCode: r.naicsCode ?? "",
      setAside: r.setAside ?? "",
      setAsideEligible: setAsideEligibility(r.setAside ?? "", se),
      reasons: (r.reasons ?? []) as string[],
      awardedTo: r.awardedTo ?? "",
      competitors: competitorsByOpp.get(r.opportunityId) ?? [],
      awardValue: parseMoney(r.awardValue),
      estimateMid,
      hasDebriefNotes,
    };
  });
}

export async function getLossIntelligence(organizationId: string): Promise<LossIntelligence> {
  const pursuits = await loadDecidedPursuits(organizationId);
  return detectLossPatterns(pursuits);
}
