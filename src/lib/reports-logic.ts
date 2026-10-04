/**
 * BL-PACKAGES add-ons Slice 2c — the Reports page's arithmetic, kept
 * pure so it is unit-tested: win rate by agency / NAICS / set-aside,
 * the stage funnel with conversion, a monthly created-vs-won series and
 * the headline numbers. Values come from the opportunity's free-text
 * value fields (high, else low) through the shared money parser.
 */

import { parseDollars } from "@/lib/money";

export type ReportOpp = {
  agency: string;
  naicsCode: string;
  setAside: string;
  stage: string;
  valueLow: string;
  valueHigh: string;
  createdAt: Date;
  awardDate: Date | null;
  updatedAt: Date;
};

export const REPORT_RANGES = ["12m", "24m", "all"] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];
export const REPORT_RANGE_LABELS: Record<ReportRange, string> = { "12m": "Last 12 months", "24m": "Last 24 months", all: "All time" };

export function parseReportRange(raw: unknown): ReportRange {
  return (REPORT_RANGES as readonly unknown[]).includes(raw) ? (raw as ReportRange) : "12m";
}

/** Start of the window (first day of the month, UTC), or null for all time. */
export function rangeStart(range: ReportRange, now: Date = new Date()): Date | null {
  if (range === "all") return null;
  const months = range === "12m" ? 12 : 24;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
}

export function oppValue(o: Pick<ReportOpp, "valueLow" | "valueHigh">): number {
  return parseDollars(o.valueHigh) || parseDollars(o.valueLow);
}

/** When an opportunity was won, for the monthly series. */
function wonAt(o: ReportOpp): Date {
  return o.awardDate ?? o.updatedAt;
}

const CLOSED = new Set(["won", "lost", "no_bid"]);

export type WinRateRow = { key: string; decided: number; won: number; lost: number; noBid: number; winRate: number | null; wonValue: number };
export type WinRateDimension = "agency" | "naicsCode" | "setAside";

/**
 * Win rate per value of one dimension: won ÷ (won + lost). No-bids are
 * counted beside it, not in the rate. Blank values group as "(not set)".
 * Busiest first; at most `limit` rows.
 */
export function winRateBy(rows: ReportOpp[], dim: WinRateDimension, limit = 25): WinRateRow[] {
  const by = new Map<string, WinRateRow>();
  for (const o of rows) {
    if (!CLOSED.has(o.stage)) continue;
    const key = o[dim].trim() || "(not set)";
    const r = by.get(key) ?? { key, decided: 0, won: 0, lost: 0, noBid: 0, winRate: null, wonValue: 0 };
    if (o.stage === "won") {
      r.won += 1;
      r.wonValue += oppValue(o);
    } else if (o.stage === "lost") r.lost += 1;
    else r.noBid += 1;
    r.decided = r.won + r.lost;
    r.winRate = r.decided > 0 ? r.won / r.decided : null;
    by.set(key, r);
  }
  return [...by.values()]
    .sort((a, b) => b.decided + b.noBid - (a.decided + a.noBid) || a.key.localeCompare(b.key))
    .slice(0, limit);
}

/** The pipeline in order. "won" closes it; lost and no-bid leave it. */
export const FUNNEL_STAGES = ["identified", "sources_sought", "qualification", "capture", "pre_proposal", "writing", "submitted", "won"] as const;

export const STAGE_LABELS: Record<string, string> = {
  identified: "Identified",
  sources_sought: "Sources sought",
  qualification: "Qualification",
  capture: "Capture",
  pre_proposal: "Pre-proposal",
  writing: "Writing",
  submitted: "Submitted",
  won: "Won",
  lost: "Lost",
  no_bid: "No bid",
};

/**
 * How far an opportunity got, as an index into FUNNEL_STAGES, from its
 * current stage. A lost bid got as far as submitted; a no-bid is read as
 * having left at qualification (the decision point). Stages advance in
 * order in FORGE, so the current stage stands for everything before it.
 */
export function stageReached(stage: string): number {
  if (stage === "lost") return FUNNEL_STAGES.indexOf("submitted");
  if (stage === "no_bid") return FUNNEL_STAGES.indexOf("qualification");
  return FUNNEL_STAGES.indexOf(stage as (typeof FUNNEL_STAGES)[number]);
}

export type FunnelRow = { stage: string; label: string; current: number; reached: number; conversion: number | null };

/** Per stage: how many sit there now, how many got at least that far, and the share of the previous stage that did. */
export function stageFunnel(rows: ReportOpp[]): FunnelRow[] {
  const reached = new Array<number>(FUNNEL_STAGES.length).fill(0);
  const current = new Map<string, number>();
  for (const o of rows) {
    current.set(o.stage, (current.get(o.stage) ?? 0) + 1);
    const at = stageReached(o.stage);
    for (let i = 0; i <= at; i++) reached[i]! += 1;
  }
  return FUNNEL_STAGES.map((stage, i) => ({
    stage,
    label: STAGE_LABELS[stage] ?? stage,
    current: current.get(stage) ?? 0,
    reached: reached[i]!,
    conversion: i === 0 ? null : reached[i - 1]! > 0 ? reached[i]! / reached[i - 1]! : null,
  }));
}

export type MonthRow = { month: string; created: number; createdValue: number; won: number; wonValue: number };

/** The last `months` calendar months (UTC), oldest first: opportunities created and won in each. */
export function monthlySeries(rows: ReportOpp[], now: Date = new Date(), months = 12): MonthRow[] {
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    keys.push(d.toISOString().slice(0, 7));
  }
  const out = new Map(keys.map((k) => [k, { month: k, created: 0, createdValue: 0, won: 0, wonValue: 0 }]));
  for (const o of rows) {
    const c = out.get(o.createdAt.toISOString().slice(0, 7));
    if (c) {
      c.created += 1;
      c.createdValue += oppValue(o);
    }
    if (o.stage === "won") {
      const w = out.get(wonAt(o).toISOString().slice(0, 7));
      if (w) {
        w.won += 1;
        w.wonValue += oppValue(o);
      }
    }
  }
  return keys.map((k) => out.get(k)!);
}

export type ReportSummary = { total: number; open: number; won: number; lost: number; noBid: number; winRate: number | null; openValue: number; wonValue: number };

export function reportSummary(rows: ReportOpp[]): ReportSummary {
  let won = 0;
  let lost = 0;
  let noBid = 0;
  let openValue = 0;
  let wonValue = 0;
  for (const o of rows) {
    if (o.stage === "won") {
      won += 1;
      wonValue += oppValue(o);
    } else if (o.stage === "lost") lost += 1;
    else if (o.stage === "no_bid") noBid += 1;
    else openValue += oppValue(o);
  }
  return { total: rows.length, open: rows.length - won - lost - noBid, won, lost, noBid, winRate: won + lost > 0 ? won / (won + lost) : null, openValue, wonValue };
}

export type Report = {
  range: ReportRange;
  summary: ReportSummary;
  byAgency: WinRateRow[];
  byNaics: WinRateRow[];
  bySetAside: WinRateRow[];
  funnel: FunnelRow[];
  months: MonthRow[];
};

/**
 * The whole report. Tables cover opportunities created in the range;
 * the monthly series always shows the last 12 months.
 */
export function buildReport(all: ReportOpp[], range: ReportRange, now: Date = new Date()): Report {
  const start = rangeStart(range, now);
  const rows = start ? all.filter((o) => o.createdAt.getTime() >= start.getTime()) : all;
  return {
    range,
    summary: reportSummary(rows),
    byAgency: winRateBy(rows, "agency"),
    byNaics: winRateBy(rows, "naicsCode"),
    bySetAside: winRateBy(rows, "setAside"),
    funnel: stageFunnel(rows),
    months: monthlySeries(all, now, 12),
  };
}

export function formatRate(r: number | null): string {
  return r === null ? "—" : `${Math.round(r * 100)}%`;
}
