/**
 * BL-FB-SOL-CUSTOMER-PATTERN — past-customer intelligence (pure).
 *
 * When a solicitation arrives, the capture lead wants to know in one
 * glance: have we seen this agency before, what do they buy from us,
 * who beats us there, what do awards run, what did their evaluators
 * say they care about, and how do we do against them. This module turns
 * the org's own pursuits, outcomes and past solicitations for one agency
 * into that summary. Deterministic; no DB, no server-only.
 *
 * Agency names are messy ("DHS", "Dept. of Homeland Security"), so
 * matching is on normalised names with containment either way. That
 * errs toward grouping, which is the useful failure mode here.
 */
import { normalizeName } from "@/lib/loss-patterns";

export type CustomerPursuitRow = {
  opportunityId: string;
  title: string;
  stage: string;
  naicsCode: string;
  setAside: string;
  estimateMid: number | null;
  outcome: "won" | "lost" | null;
  awardedTo: string;
  awardValue: number | null;
  decidedAt: string | null;
};

export type CustomerSolicitationRow = {
  id: string;
  title: string;
  solicitationNumber: string;
  naicsCode: string;
  setAside: string;
  sectionMSummary: string;
  responseDueDate: string | null;
  createdAt: string;
};

export type CustomerMarket = {
  source: "usaspending";
  awards: number;
  totalObligated: number;
  topRecipients: { name: string; amount: number; awards: number }[];
  yearsBack: number;
};

export type CustomerHistory = {
  agency: string;
  pursuits: number;
  won: number;
  lost: number;
  open: number;
  winRate: number | null;
  solicitationsSeen: number;
  naicsMix: { code: string; count: number }[];
  setAsideMix: { setAside: string; count: number }[];
  avgEstimate: number | null;
  avgAward: number | null;
  /** Competitors who took awards we lost at this agency. */
  winners: { name: string; count: number }[];
  /** Section M summaries from past solicitations at this agency, newest first. */
  evaluatorPriorities: { solicitationId: string; title: string; summary: string }[];
  recentPursuits: {
    opportunityId: string;
    title: string;
    stage: string;
    outcome: "won" | "lost" | null;
    decidedAt: string | null;
  }[];
};

const OPEN_STAGES = new Set([
  "identified",
  "sources_sought",
  "qualification",
  "capture",
  "pre_proposal",
  "writing",
  "submitted",
]);

/** Normalised containment either way, with a floor so "va" never matches everything. */
export function agencyMatches(a: string, b: string): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const shorter = x.length <= y.length ? x : y;
  const longer = shorter === x ? y : x;
  return shorter.length >= 4 && longer.includes(shorter);
}

export function formatMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function average(xs: number[]): number | null {
  const v = xs.filter((n) => Number.isFinite(n) && n > 0);
  if (v.length === 0) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

function countBy<T>(rows: T[], key: (r: T) => string): { key: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r).trim();
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}

export function summarizeCustomerHistory(input: {
  agency: string;
  pursuits: CustomerPursuitRow[];
  solicitations: CustomerSolicitationRow[];
}): CustomerHistory {
  const { pursuits, solicitations } = input;
  const won = pursuits.filter((p) => p.outcome === "won").length;
  const lost = pursuits.filter((p) => p.outcome === "lost").length;
  const open = pursuits.filter((p) => p.outcome === null && OPEN_STAGES.has(p.stage)).length;
  const decided = won + lost;

  // Who beat us: winners named on losses, merged by normalised name.
  const winnerMap = new Map<string, { name: string; count: number }>();
  for (const p of pursuits) {
    if (p.outcome !== "lost" || !p.awardedTo.trim()) continue;
    const key = normalizeName(p.awardedTo);
    if (!key) continue;
    const cur = winnerMap.get(key) ?? { name: p.awardedTo.trim(), count: 0 };
    cur.count += 1;
    winnerMap.set(key, cur);
  }

  const bySolicitationDate = [...solicitations].sort((a, b) =>
    (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
  );

  const recentPursuits = [...pursuits]
    .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""))
    .slice(0, 5)
    .map((p) => ({
      opportunityId: p.opportunityId,
      title: p.title,
      stage: p.stage,
      outcome: p.outcome,
      decidedAt: p.decidedAt,
    }));

  return {
    agency: input.agency,
    pursuits: pursuits.length,
    won,
    lost,
    open,
    winRate: decided > 0 ? won / decided : null,
    solicitationsSeen: solicitations.length,
    naicsMix: countBy(pursuits, (p) => p.naicsCode)
      .slice(0, 5)
      .map((c) => ({ code: c.key, count: c.count })),
    setAsideMix: countBy(pursuits, (p) => p.setAside)
      .slice(0, 5)
      .map((c) => ({ setAside: c.key, count: c.count })),
    avgEstimate: average(pursuits.map((p) => p.estimateMid ?? 0)),
    avgAward: average(pursuits.map((p) => p.awardValue ?? 0)),
    winners: [...winnerMap.values()].sort((a, b) => b.count - a.count).slice(0, 5),
    evaluatorPriorities: bySolicitationDate
      .filter((s) => s.sectionMSummary.trim().length > 0)
      .slice(0, 3)
      .map((s) => ({
        solicitationId: s.id,
        title: s.title || s.solicitationNumber || "Untitled solicitation",
        summary: s.sectionMSummary.trim().slice(0, 600),
      })),
    recentPursuits,
  };
}

/**
 * Roll USAspending awards for an agency (optionally within a NAICS)
 * into a market view: how much they buy and who they buy from.
 */
export function summarizeMarket(
  awards: { recipientName: string; amount: number }[],
  yearsBack: number,
): CustomerMarket {
  const byRecipient = new Map<string, { name: string; amount: number; awards: number }>();
  let total = 0;
  for (const a of awards) {
    const amt = Number.isFinite(a.amount) ? a.amount : 0;
    total += amt;
    const key = normalizeName(a.recipientName);
    if (!key) continue;
    const cur = byRecipient.get(key) ?? { name: a.recipientName.trim(), amount: 0, awards: 0 };
    cur.amount += amt;
    cur.awards += 1;
    byRecipient.set(key, cur);
  }
  return {
    source: "usaspending",
    awards: awards.length,
    totalObligated: total,
    topRecipients: [...byRecipient.values()].sort((a, b) => b.amount - a.amount).slice(0, 5),
    yearsBack,
  };
}
