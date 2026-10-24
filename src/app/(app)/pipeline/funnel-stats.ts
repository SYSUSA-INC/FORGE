import type { OpportunityStage } from "@/db/schema";
import { weightedValueOf } from "@/lib/pipeline-drill";
import { STAGES, canonicalStage } from "@/lib/opportunity-types";
import { FUNNEL_STAGES, stageReached } from "@/lib/reports-logic";

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
  /**
   * BL-PIPE-FUNNEL — how many got at least this far (a lost bid reached
   * Submitted, a no-bid left at Qualification: reports-logic.stageReached).
   * For lost and no-bid it is the count itself.
   */
  reached: number;
  /** Share of the previous funnel stage that reached this one; null for the first and for lost / no-bid. */
  conversion: number | null;
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
      reached: 0,
      conversion: null,
    };
    if (s.phase === "closed") closed.push(stat);
    else active.push(stat);
  }

  const byKey: Record<string, FunnelStageStat> = {};
  for (const s of [...active, ...closed]) byKey[s.key] = s;

  for (const r of rows) {
    const stat = byKey[canonicalStage(r.stage)];
    if (!stat) continue;
    stat.count += 1;
    // BL-PIPE-DRILL — the same rule the "Pipeline value" drill-down lists by.
    stat.weightedValue += weightedValueOf(r);
    const at = stageReached(canonicalStage(r.stage));
    for (let i = 0; i <= at; i++) {
      const step = byKey[FUNNEL_STAGES[i]!];
      if (step) step.reached += 1;
    }
  }
  FUNNEL_STAGES.forEach((key, i) => {
    const step = byKey[key];
    const prev = i > 0 ? byKey[FUNNEL_STAGES[i - 1]!] : undefined;
    if (!step) return;
    step.conversion = prev && prev.reached > 0 ? step.reached / prev.reached : null;
  });
  for (const s of closed) if (s.key !== "won") s.reached = s.count;

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
