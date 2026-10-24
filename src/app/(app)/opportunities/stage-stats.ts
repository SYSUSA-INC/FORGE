import type { OpportunityStage } from "@/db/schema";
import { parseDollars } from "@/lib/money";
import { STAGES, canonicalStage } from "@/lib/opportunity-types";

/**
 * Per-stage aggregates surfaced on the dashboard widget grid.
 *
 *   count          — how many opportunities are in this stage
 *   soonestDue     — earliest non-past-due response_due_date in this stage
 *                    (null if none have a due date or all are past)
 *   pastDueCount   — opportunities whose response date already elapsed
 *                    (signals stale data that needs cleanup). Only for
 *                    stages still working to that date: submitted, won,
 *                    lost and no-bid pursuits are past it by definition.
 *   totalValueLow  — sum of parsed `valueLow` strings across the stage
 *   totalValueHigh — sum of parsed `valueHigh` strings across the stage
 *
 * Value totals use the same `parseDollars` lossy parser as the
 * pipeline funnel — unparseable inputs contribute 0.
 */
export type StageStat = {
  count: number;
  soonestDue: Date | null;
  pastDueCount: number;
  totalValueLow: number;
  totalValueHigh: number;
};

type RowLike = {
  stage: OpportunityStage;
  responseDueDate: Date | null;
  valueLow: string;
  valueHigh: string;
};

/** Stages where the response date is meant to have passed. */
const PAST_THE_DATE = new Set(
  STAGES.filter((s) => s.phase === "closed" || s.key === "submitted").map((s) => s.key),
);

export function buildStageStats(rows: RowLike[]): Record<string, StageStat> {
  const out: Record<string, StageStat> = {};
  const now = Date.now();

  for (const r of rows) {
    const stage = canonicalStage(r.stage);
    let stat = out[stage];
    if (!stat) {
      stat = {
        count: 0,
        soonestDue: null,
        pastDueCount: 0,
        totalValueLow: 0,
        totalValueHigh: 0,
      };
      out[stage] = stat;
    }
    stat.count += 1;
    stat.totalValueLow += parseDollars(r.valueLow);
    stat.totalValueHigh += parseDollars(r.valueHigh);

    if (r.responseDueDate && !PAST_THE_DATE.has(stage)) {
      if (r.responseDueDate.getTime() < now) {
        stat.pastDueCount += 1;
      } else {
        const cur = stat.soonestDue;
        if (!cur || r.responseDueDate < cur) {
          stat.soonestDue = r.responseDueDate;
        }
      }
    }
  }

  return out;
}

/**
 * Format the `soonestDue` proximity as a short, human-readable
 * string. Returns null when there's nothing meaningful to show.
 *
 *   today       → "due today"
 *   tomorrow    → "due tomorrow"
 *   < 14 days   → "due in N days"
 *   else        → ISO short date (e.g. "Apr 30")
 */
export function formatDueProximity(soonest: Date | null): string | null {
  if (!soonest) return null;
  const ms = soonest.getTime() - Date.now();
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  if (days <= 0) return "due today";
  if (days === 1) return "due tomorrow";
  if (days <= 14) return `due in ${days} days`;
  return `due ${soonest.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

/**
 * Spell-out helper: "S1" → "Stage 1", "S6" → "Stage 6", and pass-
 * through for closed-state codes (W → "Closed-Won", L and NB → "Archived").
 *
 * Lives in this file (not StageWidget.tsx) so server components can
 * import it. Putting it next to a "use client" boundary turns the
 * import into a Client Component reference at build time — calling
 * it from a server-rendered tree throws "n is not a function" during
 * the RSC payload toJSON pass.
 */
export function spellOutStageCode(shortLabel: string): string {
  if (/^S\d+$/.test(shortLabel)) return `Stage ${shortLabel.slice(1)}`;
  if (shortLabel === "W") return "Closed-Won";
  if (shortLabel === "L") return "Archived · Lost";
  if (shortLabel === "NB") return "Archived · No bid";
  return shortLabel;
}
