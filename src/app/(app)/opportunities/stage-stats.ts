import type { OpportunityStage } from "@/db/schema";

/**
 * Per-stage aggregates surfaced on the dashboard widget grid.
 *
 *   count          — how many opportunities are in this stage
 *   soonestDue     — earliest non-past-due response_due_date in this stage
 *                    (null if none have a due date or all are past)
 *   pastDueCount   — opportunities whose response date already elapsed
 *                    (signals stale data that needs cleanup)
 */
export type StageStat = {
  count: number;
  soonestDue: Date | null;
  pastDueCount: number;
};

type RowLike = {
  stage: OpportunityStage;
  responseDueDate: Date | null;
};

export function buildStageStats(rows: RowLike[]): Record<string, StageStat> {
  const out: Record<string, StageStat> = {};
  const now = Date.now();

  for (const r of rows) {
    let stat = out[r.stage];
    if (!stat) {
      stat = { count: 0, soonestDue: null, pastDueCount: 0 };
      out[r.stage] = stat;
    }
    stat.count += 1;

    if (r.responseDueDate) {
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
 * Spell-out helper: "S1" → "Stage 1", "S7" → "Stage 7", and pass-
 * through for closed-state codes (W → "Won", L → "Lost", NB → "No Bid").
 *
 * Lives in this file (not StageWidget.tsx) so server components can
 * import it. Putting it next to a "use client" boundary turns the
 * import into a Client Component reference at build time — calling
 * it from a server-rendered tree throws "n is not a function" during
 * the RSC payload toJSON pass.
 */
export function spellOutStageCode(shortLabel: string): string {
  if (/^S\d+$/.test(shortLabel)) return `Stage ${shortLabel.slice(1)}`;
  if (shortLabel === "W") return "Won";
  if (shortLabel === "L") return "Lost";
  if (shortLabel === "NB") return "No Bid";
  return shortLabel;
}
