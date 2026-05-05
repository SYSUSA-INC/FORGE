import type { OpportunityStage } from "@/db/schema";
import { STAGES } from "@/lib/opportunity-types";

/**
 * Per-stage aggregates for the pipeline funnel — count, weighted
 * value, and (for upcoming due dates) soonest due. Computed
 * server-side from the row set; both view modes (count / value)
 * read from the same struct.
 */
export type FunnelStageStat = {
  key: OpportunityStage;
  shortLabel: string;
  label: string;
  color: string;
  count: number;
  weightedValue: number; // PWin% × midpoint(valueLow, valueHigh) summed
};

export type FunnelData = {
  /** The 7 active stages (S1-S7) in order — what the funnel renders. */
  active: FunnelStageStat[];
  /** Closed states (W / L / NB) for the outcome split below. */
  closed: FunnelStageStat[];
  totalCount: number;
  totalWeightedValue: number;
  /** Win rate = won / (won + lost). No-bid is excluded. Null if no
   *  decisive closures yet. */
  winRate: number | null;
};

type RowLike = {
  stage: OpportunityStage;
  pWin: number;
  valueLow: string;
  valueHigh: string;
};

export function buildFunnelData(rows: RowLike[]): FunnelData {
  const active: FunnelStageStat[] = [];
  const closed: FunnelStageStat[] = [];

  for (const s of STAGES) {
    const stat: FunnelStageStat = {
      key: s.key,
      shortLabel: s.shortLabel,
      label: s.label,
      color: s.color,
      count: 0,
      weightedValue: 0,
    };
    if (s.phase === "closed") closed.push(stat);
    else active.push(stat);
  }

  const byKey: Record<string, FunnelStageStat> = {};
  for (const s of [...active, ...closed]) byKey[s.key] = s;

  for (const r of rows) {
    const stat = byKey[r.stage];
    if (!stat) continue;
    stat.count += 1;
    const low = parseDollars(r.valueLow);
    const high = parseDollars(r.valueHigh);
    const mid = high > 0 && low > 0 ? (low + high) / 2 : Math.max(low, high);
    const pWinFrac = Math.max(0, Math.min(100, r.pWin)) / 100;
    stat.weightedValue += mid * pWinFrac;
  }

  const totalCount = active.reduce((s, x) => s + x.count, 0)
    + closed.reduce((s, x) => s + x.count, 0);
  const totalWeightedValue = active.reduce((s, x) => s + x.weightedValue, 0)
    + closed.reduce((s, x) => s + x.weightedValue, 0);

  const won = byKey["won"]?.count ?? 0;
  const lost = byKey["lost"]?.count ?? 0;
  const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null;

  return { active, closed, totalCount, totalWeightedValue, winRate };
}

/**
 * Lossy parser for free-text dollar values: "10M" / "$1.5B" /
 * "500,000" / "1.2k" → number. Returns 0 for unparseable inputs.
 */
export function parseDollars(s: string): number {
  if (!s) return 0;
  const trimmed = s.trim().replace(/[$,]/g, "");
  const m = trimmed.match(/^([\d.]+)\s*([kKmMbB])?$/);
  if (!m) {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : 0;
  }
  const base = Number(m[1]);
  if (!Number.isFinite(base)) return 0;
  const suffix = (m[2] ?? "").toLowerCase();
  if (suffix === "k") return base * 1_000;
  if (suffix === "m") return base * 1_000_000;
  if (suffix === "b") return base * 1_000_000_000;
  return base;
}

export function formatDollars(n: number): string {
  if (n === 0) return "—";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}
