import type { OpportunityStage } from "@/db/schema";
import { parseDollars } from "@/lib/money";
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

// parseDollars + formatDollars moved to src/lib/money.ts (shared with
// BL-3's widget grid). Re-exported here for any caller that still
// imports the names from this module.
export { parseDollars, formatDollars } from "@/lib/money";
