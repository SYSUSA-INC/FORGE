/**
 * BL-PIPE-DRILL — the pipeline's tiles open the opportunities behind
 * their numbers (owner's ask, 2026-10-13). Pure: the same rules decide
 * the numbers on /pipeline and the list on /opportunities, so a tile's
 * count is always the length of the list it opens.
 *
 *   In window      → every opportunity created in the window
 *   Active         → those in an active stage (Identified … Submitted)
 *   Win rate       → those won or lost (no-bids don't count)
 *   Pipeline value → those with a value, largest weighted value first
 *                    (one with PWin 0 shows $0, so a missing PWin is visible)
 */
import type { OpportunityStage } from "@/db/schema";
import { formatDollars, parseDollars } from "@/lib/money";
import { STAGES } from "@/lib/opportunity-types";

export type PipelineWindow = "30" | "90" | "365" | "all";
export type PipelineView = "active" | "decided" | "valued";
/** `explicit`: the window came from the URL (a link from the pipeline), even "all". */
export type PipelineDrill = { days: PipelineWindow; view: PipelineView | null; explicit: boolean; mode: "count" | "value" };

const WINDOWS = new Set<string>(["30", "90", "365", "all"]);
const VIEWS = new Set<string>(["active", "decided", "valued"]);
const ACTIVE = new Set<string>(STAGES.filter((s) => s.phase !== "closed").map((s) => s.key));

/**
 * `?days=`, `?view=` and the pipeline's `?mode=` from a URL. Links from the
 * pipeline always carry `days` (even "all"); a bare /opportunities or a
 * Command Center `?stage=` link isn't a drill.
 */
export function parsePipelineDrill(sp: { days?: string; view?: string; mode?: string }): PipelineDrill {
  const explicit = !!sp.days && WINDOWS.has(sp.days);
  return {
    days: explicit ? (sp.days as PipelineWindow) : "all",
    view: sp.view && VIEWS.has(sp.view) ? (sp.view as PipelineView) : null,
    explicit,
    mode: sp.mode === "value" ? "value" : "count",
  };
}

export function isDrill(d: PipelineDrill): boolean {
  return d.explicit || d.view !== null;
}

/** The opportunities list behind a pipeline number (the pipeline's value mode kept for the way back). */
export function drillHref(days: PipelineWindow, view?: PipelineView | null, stage?: OpportunityStage, mode: "count" | "value" = "count"): string {
  const q = new URLSearchParams();
  if (stage) q.set("stage", stage);
  q.set("days", days);
  if (view) q.set("view", view);
  if (mode === "value") q.set("mode", "value");
  return `/opportunities?${q.toString()}`;
}

/** Back to the pipeline the drill came from. */
export function pipelineHref(d: PipelineDrill): string {
  return `/pipeline?days=${d.days}${d.mode === "value" ? "&mode=value" : ""}`;
}

/** The window's start, or null for all time. */
export function windowStart(days: PipelineWindow, now: Date): Date | null {
  return days === "all" ? null : new Date(now.getTime() - Number(days) * 86_400_000);
}

/** PWin% × the midpoint of the value range (one end when only one is set). */
export function weightedValueOf(r: { pWin: number; valueLow: string; valueHigh: string }): number {
  const low = parseDollars(r.valueLow);
  const high = parseDollars(r.valueHigh);
  const mid = high > 0 && low > 0 ? (low + high) / 2 : Math.max(low, high);
  return mid * (Math.max(0, Math.min(100, r.pWin)) / 100);
}

type Row = { stage: OpportunityStage; createdAt: Date; pWin: number; valueLow: string; valueHigh: string };

/** The rows behind a drill, in the order to show them (largest weighted value first for "valued"). */
export function applyDrill<T extends Row>(rows: T[], d: PipelineDrill, now: Date): T[] {
  const since = windowStart(d.days, now);
  const inWindow = since ? rows.filter((r) => r.createdAt.getTime() >= since.getTime()) : rows;
  if (d.view === "active") return inWindow.filter((r) => ACTIVE.has(r.stage));
  if (d.view === "decided") return inWindow.filter((r) => r.stage === "won" || r.stage === "lost");
  if (d.view === "valued") {
    const top = (r: Row) => Math.max(parseDollars(r.valueLow), parseDollars(r.valueHigh));
    return inWindow
      .filter((r) => top(r) > 0)
      .map((r) => ({ r, w: weightedValueOf(r), v: top(r) }))
      .sort((a, b) => b.w - a.w || b.v - a.v)
      .map((x) => x.r);
  }
  return inWindow;
}

/** The line above a drilled list: what it holds and how the number was made. */
export function drillSummary<T extends Row>(rows: T[], d: PipelineDrill): string {
  const when = d.days === "all" ? "All opportunities" : `Opportunities created in the last ${d.days} days`;
  const n = rows.length;
  if (d.view === "active") return `${when} in an active stage (Identified to Submitted): ${n}.`;
  if (d.view === "decided") {
    const won = rows.filter((r) => r.stage === "won").length;
    const lost = n - won;
    const rate = n > 0 ? `${Math.round((won / n) * 100)}%` : "—";
    return `${when} that were won or lost: ${won} won, ${lost} lost, a win rate of ${rate} (no-bids aren't counted).`;
  }
  if (d.view === "valued") {
    const total = rows.reduce((s, r) => s + weightedValueOf(r), 0);
    const noPwin = rows.filter((r) => weightedValueOf(r) === 0).length;
    return `${when} with a value, largest weighted value first: ${n}, worth ${formatDollars(total)} weighted (PWin × the middle of each value range)${noPwin ? `; ${noPwin} with a PWin of 0 add nothing` : ""}.`;
  }
  return `${when}: ${n}.`;
}
