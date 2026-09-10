/**
 * BL-FB-SOL-CUSTOMER-PATTERN — server side: assemble an org's history
 * with one agency for the solicitation page.
 *
 * Pulls the org's opportunities, their decided outcomes and past
 * solicitations, keeps the rows whose agency matches, and summarises
 * them with the pure module. Optionally adds a USAspending market view
 * (who the agency buys from, market-wide) and the PWin model's estimate
 * for the linked opportunity. Both extras are best-effort and gated, so
 * a slow public API can never block the page. Scoped by organizationId.
 */
import "server-only";

import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { opportunities, proposalOutcomes, proposals, solicitations } from "@/db/schema";
import {
  agencyMatches,
  summarizeCustomerHistory,
  summarizeMarket,
  type CustomerHistory,
  type CustomerMarket,
  type CustomerPursuitRow,
  type CustomerSolicitationRow,
} from "@/lib/customer-patterns";
import { parseMoney } from "@/lib/loss-patterns";
import { log } from "@/lib/log";
import { computePwin } from "@/lib/pwin";
import { searchAwardsByCriteria } from "@/lib/usaspending";

const MARKET_TIMEOUT_MS = 4_000;
const MARKET_YEARS_BACK = 5;

export type CustomerIntelligence = {
  history: CustomerHistory;
  market: CustomerMarket | null;
  /** Model estimate for the linked opportunity, when there is one. */
  modelPwin: { pwin: number; confidence: string; recordPwin: number } | null;
};

export async function getCustomerIntelligence(input: {
  organizationId: string;
  agency: string;
  /** Solicitation being viewed; excluded from "seen before". */
  excludeSolicitationId?: string;
  linkedOpportunityId?: string | null;
  naicsCode?: string;
}): Promise<CustomerIntelligence | null> {
  const agency = input.agency.trim();
  if (!agency) return null;
  const { organizationId } = input;

  // Opportunities at this agency (filter in JS so the fuzzy match is
  // one implementation, shared with the pure module).
  const oppRows = await db
    .select({
      id: opportunities.id,
      title: opportunities.title,
      stage: opportunities.stage,
      agency: opportunities.agency,
      naicsCode: opportunities.naicsCode,
      setAside: opportunities.setAside,
      valueLow: opportunities.valueLow,
      valueHigh: opportunities.valueHigh,
    })
    .from(opportunities)
    .where(eq(opportunities.organizationId, organizationId));
  const matched = oppRows.filter((o) => agencyMatches(o.agency ?? "", agency));
  const oppIds = matched.map((o) => o.id);

  // Decided outcomes for those opportunities.
  const outcomeByOpp = new Map<
    string,
    { outcome: "won" | "lost"; awardedTo: string; awardValue: number | null; decidedAt: string | null }
  >();
  if (oppIds.length > 0) {
    const outcomeRows = await db
      .select({
        opportunityId: proposals.opportunityId,
        outcomeType: proposalOutcomes.outcomeType,
        awardedTo: proposalOutcomes.awardedToCompetitor,
        awardValue: proposalOutcomes.awardValue,
        decisionDate: proposalOutcomes.decisionDate,
        updatedAt: proposalOutcomes.updatedAt,
      })
      .from(proposalOutcomes)
      .innerJoin(proposals, eq(proposals.id, proposalOutcomes.proposalId))
      .where(
        and(
          eq(proposalOutcomes.organizationId, organizationId),
          inArray(proposals.opportunityId, oppIds),
          inArray(proposalOutcomes.outcomeType, ["won", "lost"]),
        ),
      )
      .orderBy(desc(proposalOutcomes.updatedAt));
    for (const r of outcomeRows) {
      if (outcomeByOpp.has(r.opportunityId)) continue; // newest wins
      const decided = r.decisionDate ?? r.updatedAt;
      outcomeByOpp.set(r.opportunityId, {
        outcome: r.outcomeType === "won" ? "won" : "lost",
        awardedTo: r.awardedTo ?? "",
        awardValue: parseMoney(r.awardValue),
        decidedAt: decided ? new Date(decided).toISOString() : null,
      });
    }
  }

  const pursuits: CustomerPursuitRow[] = matched.map((o) => {
    const low = parseMoney(o.valueLow);
    const high = parseMoney(o.valueHigh);
    const oc = outcomeByOpp.get(o.id);
    return {
      opportunityId: o.id,
      title: o.title,
      stage: o.stage,
      naicsCode: o.naicsCode ?? "",
      setAside: o.setAside ?? "",
      estimateMid: low && high ? (low + high) / 2 : (low ?? high),
      outcome: oc?.outcome ?? null,
      awardedTo: oc?.awardedTo ?? "",
      awardValue: oc?.awardValue ?? null,
      decidedAt: oc?.decidedAt ?? null,
    };
  });

  // Past solicitations at this agency (excluding the one being viewed).
  const solWhere = input.excludeSolicitationId
    ? and(
        eq(solicitations.organizationId, organizationId),
        ne(solicitations.id, input.excludeSolicitationId),
      )
    : eq(solicitations.organizationId, organizationId);
  const solRows = await db
    .select({
      id: solicitations.id,
      title: solicitations.title,
      solicitationNumber: solicitations.solicitationNumber,
      agency: solicitations.agency,
      naicsCode: solicitations.naicsCode,
      setAside: solicitations.setAside,
      sectionMSummary: solicitations.sectionMSummary,
      responseDueDate: solicitations.responseDueDate,
      createdAt: solicitations.createdAt,
    })
    .from(solicitations)
    .where(solWhere)
    .orderBy(desc(solicitations.createdAt))
    .limit(500);
  const pastSolicitations: CustomerSolicitationRow[] = solRows
    .filter((s) => agencyMatches(s.agency ?? "", agency))
    .map((s) => ({
      id: s.id,
      title: s.title ?? "",
      solicitationNumber: s.solicitationNumber ?? "",
      naicsCode: s.naicsCode ?? "",
      setAside: s.setAside ?? "",
      sectionMSummary: s.sectionMSummary ?? "",
      responseDueDate: s.responseDueDate ? new Date(s.responseDueDate).toISOString() : null,
      createdAt: new Date(s.createdAt).toISOString(),
    }));

  const history = summarizeCustomerHistory({
    agency,
    pursuits,
    solicitations: pastSolicitations,
  });

  // Market view — gated with the rest of BD intel and time-boxed.
  let market: CustomerMarket | null = null;
  if (process.env.AWARDS_INTEL_ENABLED === "1") {
    try {
      const res = await Promise.race([
        searchAwardsByCriteria({
          awardingAgencyName: agency,
          naicsCodes: input.naicsCode ? [input.naicsCode] : undefined,
          limit: 50,
          timePeriodStart: `${new Date().getUTCFullYear() - MARKET_YEARS_BACK}-01-01`,
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), MARKET_TIMEOUT_MS)),
      ]);
      if (res && res.ok) market = summarizeMarket(res.awards, MARKET_YEARS_BACK);
    } catch (err) {
      log.warn("[customer-intelligence]", "usaspending lookup failed", { error: err });
    }
  }

  // Model estimate for the linked opportunity.
  let modelPwin: CustomerIntelligence["modelPwin"] = null;
  if (input.linkedOpportunityId) {
    try {
      const est = await computePwin(organizationId, input.linkedOpportunityId);
      if (est) {
        modelPwin = {
          pwin: est.score.pwin,
          confidence: est.score.confidence,
          recordPwin: est.manualPwin,
        };
      }
    } catch (err) {
      log.warn("[customer-intelligence]", "pwin estimate failed", { error: err });
    }
  }

  return { history, market, modelPwin };
}
