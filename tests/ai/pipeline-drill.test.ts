/**
 * BL-PIPE-DRILL — the pipeline's tiles open the opportunities behind
 * their numbers: the drill's rows are exactly what each number counts.
 */
import { describe, expect, it } from "vitest";
import type { OpportunityStage } from "@/db/schema";
import { buildFunnelData } from "@/app/(app)/pipeline/funnel-stats";
import { applyDrill, drillHref, drillSummary, isDrill, parsePipelineDrill, pipelineHref, weightedValueOf, type PipelineView, type PipelineWindow } from "@/lib/pipeline-drill";

const now = new Date("2026-10-13T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const row = (id: string, stage: OpportunityStage, age: number, pWin = 50, valueLow = "", valueHigh = "") => ({ id, stage, createdAt: daysAgo(age), pWin, valueLow, valueHigh });

const ROWS = [
  row("a", "identified", 5, 20, "$1M", "$3M"), // weighted 400K
  row("b", "pre_proposal", 10, 50, "", "$2M"), // 1M
  row("c", "won", 20, 100, "$500K", "$500K"), // 500K
  row("d", "lost", 40, 30),
  row("e", "no_bid", 60, 10, "$9M", ""), // 900K
  row("f", "submitted", 200, 80, "$1M", "$1M"), // 800K, outside 90 days
  row("g", "lost", 400, 40, "$2M", "$2M"), // outside 365 days
  row("h", "capture", 15, 0, "$4M", ""), // a value but no PWin: listed, adds $0
];
const d = (days: PipelineWindow, view: PipelineView | null = null) => ({ days, view, explicit: true, mode: "count" as const });

describe("BL-PIPE-DRILL — pipeline numbers open their lists", () => {
  it("reads and writes the drill in the URL", () => {
    expect(parsePipelineDrill({ days: "90", view: "active" })).toEqual({ days: "90", view: "active", explicit: true, mode: "count" });
    expect(parsePipelineDrill({ days: "7", view: "everything", mode: "x" })).toEqual({ days: "all", view: null, explicit: false, mode: "count" });
    // A bare list or a Command Center ?stage= link isn't a drill; any pipeline link is, "all" included.
    expect(isDrill(parsePipelineDrill({}))).toBe(false);
    expect(isDrill(parsePipelineDrill({ days: "all" }))).toBe(true);
    expect(isDrill(parsePipelineDrill({ view: "decided" }))).toBe(true);
    expect(drillHref("90")).toBe("/opportunities?days=90");
    expect(drillHref("all")).toBe("/opportunities?days=all");
    expect(drillHref("all", "valued")).toBe("/opportunities?days=all&view=valued");
    expect(drillHref("30", null, "capture")).toBe("/opportunities?stage=capture&days=30");
    // The pipeline's value mode goes along, so "Back to the pipeline" returns to it.
    expect(drillHref("90", "valued", undefined, "value")).toBe("/opportunities?days=90&view=valued&mode=value");
    expect(pipelineHref(parsePipelineDrill({ days: "90", mode: "value" }))).toBe("/pipeline?days=90&mode=value");
    expect(pipelineHref(parsePipelineDrill({ days: "all" }))).toBe("/pipeline?days=all");
  });

  it("lists exactly what each tile counts, in every window", () => {
    for (const days of ["30", "90", "365", "all"] as PipelineWindow[]) {
      const inWindow = applyDrill(ROWS, d(days), now);
      const data = buildFunnelData(inWindow);
      const active = data.active.reduce((s, x) => s + x.count, 0);
      expect(inWindow.length, `in window ${days}`).toBe(data.totalCount);
      expect(applyDrill(ROWS, d(days, "active"), now).length, `active ${days}`).toBe(active);
      const decided = applyDrill(ROWS, d(days, "decided"), now);
      const won = decided.filter((r) => r.stage === "won").length;
      expect(decided.length ? Math.round((won / decided.length) * 100) : null, `win rate ${days}`).toBe(data.winRate);
      const valued = applyDrill(ROWS, d(days, "valued"), now);
      expect(valued.reduce((s, r) => s + weightedValueOf(r), 0), `value ${days}`).toBeCloseTo(data.totalWeightedValue);
    }
  });

  it("orders and describes each list", () => {
    const at = (view: PipelineView | null, days: PipelineWindow = "90") => applyDrill(ROWS, d(days, view), now).map((r) => r.id);
    expect(at(null)).toEqual(["a", "b", "c", "d", "e", "h"]);
    expect(at("active")).toEqual(["a", "b", "h"]);
    expect(at("decided")).toEqual(["c", "d"]);
    expect(at("valued")).toEqual(["b", "e", "c", "a", "h"]);
    // f and g tie at $800K weighted: the larger value range comes first.
    expect(at("valued", "all")).toEqual(["b", "e", "g", "f", "c", "a", "h"]);
    const sum = (view: PipelineView | null, days: PipelineWindow = "90") => drillSummary(applyDrill(ROWS, d(days, view), now), d(days, view));
    expect(sum(null)).toBe("Opportunities created in the last 90 days: 6.");
    expect(sum("active")).toBe("Opportunities created in the last 90 days in an active stage (Identified to Submitted): 3.");
    expect(sum("decided")).toBe("Opportunities created in the last 90 days that were won or lost: 1 won, 1 lost, a win rate of 50% (no-bids aren't counted).");
    expect(sum("decided", "30")).toBe("Opportunities created in the last 30 days that were won or lost: 1 won, 0 lost, a win rate of 100% (no-bids aren't counted).");
    expect(sum("valued")).toMatch(/^Opportunities created in the last 90 days with a value, largest weighted value first: 5, worth \$2\.8M weighted .*; 1 with a PWin of 0 add nothing\.$/);
    expect(sum("active", "all")).toBe("All opportunities in an active stage (Identified to Submitted): 4.");
  });
});
