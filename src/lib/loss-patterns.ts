/**
 * BL-FB-WIN-CROSS-LOSS — cross-loss pattern detection (pure).
 *
 * A single capture manager sees one debrief at a time. This module looks
 * across every decided pursuit an org has recorded and surfaces the
 * patterns no one sees pursuit-by-pursuit: the competitor you keep
 * losing to, the segment where every loss cites the same reason, price
 * losses that run consistently high, set-asides you keep bidding without
 * the certification, a sliding win rate, and the debriefs you never
 * captured. Every pattern carries its evidence so it can be checked.
 *
 * Deterministic and threshold-based on purpose: a pattern here is a fact
 * about the data, not a model's opinion. The AI narrative built on top
 * (loss-intelligence.ts) is asked to explain these, never to invent
 * its own. No DB, no server-only.
 */
import { OUTCOME_REASON_LABELS } from "@/lib/proposal-outcome-types";

export type DecidedPursuit = {
  proposalId: string;
  title: string;
  outcome: "won" | "lost";
  /** ISO date of the decision (falls back to the outcome's last update). */
  decidedAt: string | null;
  agency: string;
  naicsCode: string;
  setAside: string;
  /** From the org's socio-economic profile; null when unknown / no set-aside. */
  setAsideEligible: boolean | null;
  /** proposal_outcome.reasons values. */
  reasons: string[];
  /** Winner's name on a loss; empty otherwise. */
  awardedTo: string;
  /** Competitor names tracked on the opportunity. */
  competitors: string[];
  awardValue: number | null;
  /** Midpoint of the opportunity's estimated value range. */
  estimateMid: number | null;
  hasDebriefNotes: boolean;
};

export type LossPatternKind =
  | "competitor"
  | "segment_reason"
  | "price"
  | "eligibility"
  | "trend"
  | "debrief_gap";

export type LossSeverity = "high" | "medium" | "info";

export type LossEvidence = {
  proposalId: string;
  title: string;
  decidedAt: string | null;
};

export type LossPattern = {
  id: string;
  kind: LossPatternKind;
  severity: LossSeverity;
  title: string;
  detail: string;
  evidence: LossEvidence[];
};

export type CompetitorRecord = {
  name: string;
  /** Pursuits where this competitor was tracked or won. */
  faced: number;
  lostTo: number;
  wonAgainst: number;
  leadingReason: string | null;
  lastLossAt: string | null;
  agencies: string[];
};

export type LossIntelligence = {
  decided: number;
  won: number;
  lost: number;
  winRate: number | null;
  lossesWithDebrief: number;
  reasonTotals: { reason: string; label: string; count: number }[];
  patterns: LossPattern[];
  competitors: CompetitorRecord[];
};

/** Decided outcomes required before the AI narrative is offered. */
export const LOSS_NARRATIVE_MIN_DECIDED = 3;

// ── thresholds (documented so the UI can explain them) ────────────────

export const LOSS_THRESHOLDS = {
  competitorMinLosses: 2,
  competitorHighLosses: 3,
  segmentMinLosses: 3,
  segmentReasonShare: 0.5,
  segmentReasonHighShare: 0.75,
  priceMinSamples: 2,
  priceMedianFlag: 0.05,
  priceMedianHigh: 0.15,
  eligibilityMinLosses: 2,
  trendMinPerWindow: 3,
  trendDropPoints: 0.15,
  debriefGapMinLosses: 3,
  debriefGapShare: 0.5,
} as const;

// ── helpers ──────────────────────────────────────────────────────────

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|company|co|group|holdings)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Parse a human money string into a number: "$1.2M", "850k", "1,200,000",
 * "1.5 million", "$2B". Returns null when it cannot be read or is ≤ 0.
 */
export function parseMoney(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/,/g, "").replace(/\$/g, "").trim();
  const m = /(-?\d+(?:\.\d+)?)\s*(thousand|million|billion|[kmb])?\b/.exec(s);
  if (!m) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "k" || unit === "thousand") n *= 1_000;
  else if (unit === "m" || unit === "million") n *= 1_000_000;
  else if (unit === "b" || unit === "billion") n *= 1_000_000_000;
  return n > 0 ? n : null;
}

export function reasonLabel(reason: string): string {
  return (OUTCOME_REASON_LABELS as Record<string, string>)[reason] ?? reason;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function evidenceOf(p: DecidedPursuit): LossEvidence {
  return { proposalId: p.proposalId, title: p.title, decidedAt: p.decidedAt };
}

function topReason(losses: DecidedPursuit[]): { reason: string; count: number } | null {
  const counts = new Map<string, number>();
  for (const l of losses) for (const r of new Set(l.reasons)) counts.set(r, (counts.get(r) ?? 0) + 1);
  let best: { reason: string; count: number } | null = null;
  for (const [reason, count] of counts) {
    if (!best || count > best.count) best = { reason, count };
  }
  return best;
}

function severityRank(s: LossSeverity): number {
  return s === "high" ? 0 : s === "medium" ? 1 : 2;
}

// ── detection ────────────────────────────────────────────────────────

export function detectLossPatterns(
  pursuits: DecidedPursuit[],
  opts: { now?: Date } = {},
): LossIntelligence {
  const now = opts.now ?? new Date();
  const losses = pursuits.filter((p) => p.outcome === "lost");
  const wins = pursuits.filter((p) => p.outcome === "won");
  const patterns: LossPattern[] = [];

  // Reason totals across losses.
  const reasonCounts = new Map<string, number>();
  for (const l of losses) for (const r of new Set(l.reasons)) reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
  const reasonTotals = [...reasonCounts]
    .map(([reason, count]) => ({ reason, label: reasonLabel(reason), count }))
    .sort((a, b) => b.count - a.count);

  // ── competitors ──
  const compMap = new Map<string, CompetitorRecord & { lossRows: DecidedPursuit[] }>();
  const touch = (rawName: string) => {
    const key = normalizeName(rawName);
    if (!key) return null;
    let rec = compMap.get(key);
    if (!rec) {
      rec = { name: rawName.trim(), faced: 0, lostTo: 0, wonAgainst: 0, leadingReason: null, lastLossAt: null, agencies: [], lossRows: [] };
      compMap.set(key, rec);
    }
    return rec;
  };
  for (const p of pursuits) {
    const seen = new Set<string>();
    const names = [...p.competitors, ...(p.outcome === "lost" && p.awardedTo ? [p.awardedTo] : [])];
    for (const n of names) {
      const key = normalizeName(n);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const rec = touch(n);
      if (!rec) continue;
      rec.faced += 1;
      if (p.outcome === "won") rec.wonAgainst += 1;
    }
    if (p.outcome === "lost" && p.awardedTo) {
      const rec = touch(p.awardedTo);
      if (rec) {
        rec.lostTo += 1;
        rec.lossRows.push(p);
        if (p.agency && !rec.agencies.includes(p.agency)) rec.agencies.push(p.agency);
        if (p.decidedAt && (!rec.lastLossAt || p.decidedAt > rec.lastLossAt)) rec.lastLossAt = p.decidedAt;
      }
    }
  }
  const competitors: CompetitorRecord[] = [...compMap.values()]
    .map((rec) => {
      const top = topReason(rec.lossRows);
      return {
        name: rec.name,
        faced: rec.faced,
        lostTo: rec.lostTo,
        wonAgainst: rec.wonAgainst,
        leadingReason: top ? top.reason : null,
        lastLossAt: rec.lastLossAt,
        agencies: rec.agencies,
      };
    })
    .sort((a, b) => b.lostTo - a.lostTo || b.faced - a.faced);

  for (const rec of compMap.values()) {
    if (rec.lostTo < LOSS_THRESHOLDS.competitorMinLosses) continue;
    const top = topReason(rec.lossRows);
    const share = rec.faced > 0 ? rec.lostTo / rec.faced : 1;
    const severity: LossSeverity =
      rec.lostTo >= LOSS_THRESHOLDS.competitorHighLosses || share >= 0.6 ? "high" : "medium";
    patterns.push({
      id: `competitor:${normalizeName(rec.name)}`,
      kind: "competitor",
      severity,
      title: `Lost ${rec.lostTo} of ${rec.faced} against ${rec.name}`,
      detail: [
        rec.agencies.length ? `Agencies: ${rec.agencies.slice(0, 3).join(", ")}` : "",
        top ? `Leading reason: ${reasonLabel(top.reason)} (${top.count} of ${rec.lostTo})` : "No reasons recorded on these losses",
      ]
        .filter(Boolean)
        .join(" · "),
      evidence: rec.lossRows.map(evidenceOf),
    });
  }

  // ── segment × reason ──
  const segments: { kind: string; label: (v: string) => string; pick: (p: DecidedPursuit) => string }[] = [
    { kind: "agency", label: (v) => v, pick: (p) => p.agency.trim() },
    { kind: "naics", label: (v) => `NAICS ${v}`, pick: (p) => p.naicsCode.trim() },
    { kind: "set_aside", label: (v) => `${v} set-aside`, pick: (p) => p.setAside.trim() },
  ];
  for (const seg of segments) {
    const groups = new Map<string, DecidedPursuit[]>();
    for (const l of losses) {
      const v = seg.pick(l);
      if (!v) continue;
      groups.set(v, [...(groups.get(v) ?? []), l]);
    }
    for (const [value, rows] of groups) {
      if (rows.length < LOSS_THRESHOLDS.segmentMinLosses) continue;
      const top = topReason(rows);
      if (!top || top.count < 2) continue;
      const share = top.count / rows.length;
      if (share < LOSS_THRESHOLDS.segmentReasonShare) continue;
      const severity: LossSeverity = share >= LOSS_THRESHOLDS.segmentReasonHighShare ? "high" : "medium";
      const label = seg.label(value);
      patterns.push({
        id: `segment:${seg.kind}:${normalizeName(value)}:${top.reason}`,
        kind: "segment_reason",
        severity,
        title:
          share === 1
            ? `Every ${label} loss cites ${reasonLabel(top.reason)}`
            : `${top.count} of ${rows.length} ${label} losses cite ${reasonLabel(top.reason)}`,
        detail: `${rows.length} losses in this segment · ${Math.round(share * 100)}% share the reason`,
        evidence: rows.map(evidenceOf),
      });
    }
  }

  // ── price ──
  const priceRows = losses.filter(
    (l) => l.reasons.includes("price") && l.awardValue && l.estimateMid && l.estimateMid > 0,
  );
  if (priceRows.length >= LOSS_THRESHOLDS.priceMinSamples) {
    const deltas = priceRows.map((l) => (l.estimateMid! - l.awardValue!) / l.awardValue!);
    const med = median(deltas);
    if (med > LOSS_THRESHOLDS.priceMedianFlag) {
      patterns.push({
        id: "price:high",
        kind: "price",
        severity: med >= LOSS_THRESHOLDS.priceMedianHigh ? "high" : "medium",
        title: `Price losses ran ~${Math.round(med * 100)}% above the winning award`,
        detail: `Median across ${priceRows.length} price-cited losses, comparing the opportunity's estimated value to the recorded award value. Estimates, not bid prices — treat as directional.`,
        evidence: priceRows.map(evidenceOf),
      });
    }
  }

  // ── eligibility ──
  const ineligible = losses.filter((l) => l.setAsideEligible === false);
  if (ineligible.length >= LOSS_THRESHOLDS.eligibilityMinLosses) {
    patterns.push({
      id: "eligibility:set_aside",
      kind: "eligibility",
      severity: "medium",
      title: `${ineligible.length} losses were bids on set-asides the org profile doesn't qualify for`,
      detail: "Either the socio-economic profile is out of date, or these should have been no-bids. Both are worth fixing.",
      evidence: ineligible.map(evidenceOf),
    });
  }

  // ── trend ──
  const yearMs = 365 * 24 * 60 * 60_000;
  const dated = pursuits.filter((p) => p.decidedAt);
  const recent = dated.filter((p) => now.getTime() - Date.parse(p.decidedAt!) <= yearMs);
  const prior = dated.filter((p) => {
    const age = now.getTime() - Date.parse(p.decidedAt!);
    return age > yearMs && age <= 2 * yearMs;
  });
  if (recent.length >= LOSS_THRESHOLDS.trendMinPerWindow && prior.length >= LOSS_THRESHOLDS.trendMinPerWindow) {
    const rate = (xs: DecidedPursuit[]) => xs.filter((p) => p.outcome === "won").length / xs.length;
    const r1 = rate(prior);
    const r2 = rate(recent);
    if (r1 - r2 >= LOSS_THRESHOLDS.trendDropPoints) {
      patterns.push({
        id: "trend:win_rate_drop",
        kind: "trend",
        severity: "medium",
        title: `Win rate fell from ${Math.round(r1 * 100)}% to ${Math.round(r2 * 100)}%`,
        detail: `Prior 12 months: ${prior.length} decided · Last 12 months: ${recent.length} decided`,
        evidence: recent.filter((p) => p.outcome === "lost").map(evidenceOf),
      });
    }
  }

  // ── debrief gap ──
  const lossesWithDebrief = losses.filter((l) => l.hasDebriefNotes).length;
  if (
    losses.length >= LOSS_THRESHOLDS.debriefGapMinLosses &&
    lossesWithDebrief / losses.length < LOSS_THRESHOLDS.debriefGapShare
  ) {
    patterns.push({
      id: "debrief:gap",
      kind: "debrief_gap",
      severity: "info",
      title: `Only ${lossesWithDebrief} of ${losses.length} losses have debrief notes`,
      detail: "Patterns above are underpowered without government feedback. Request debriefs within the FAR 15.506 window and record them on the Outcome tab.",
      evidence: losses.filter((l) => !l.hasDebriefNotes).map(evidenceOf),
    });
  }

  patterns.sort(
    (a, b) => severityRank(a.severity) - severityRank(b.severity) || b.evidence.length - a.evidence.length,
  );

  const decided = pursuits.length;
  return {
    decided,
    won: wins.length,
    lost: losses.length,
    winRate: decided > 0 ? wins.length / decided : null,
    lossesWithDebrief,
    reasonTotals,
    patterns,
    competitors,
  };
}
