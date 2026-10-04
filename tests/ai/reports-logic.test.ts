/**
 * BL-PACKAGES add-ons Slice 2c — the Reports arithmetic: win rate by a
 * dimension, the stage funnel and its conversion, the monthly series,
 * the headline numbers and the date range.
 */

import { describe, expect, it } from "vitest";
import {
  buildReport,
  formatRate,
  monthlySeries,
  parseReportRange,
  rangeStart,
  reportSummary,
  stageFunnel,
  stageReached,
  winRateBy,
  type ReportOpp,
} from "@/lib/reports-logic";

const NOW = new Date("2026-10-04T12:00:00Z");
const opp = (o: Partial<ReportOpp>): ReportOpp => ({
  agency: "GSA",
  naicsCode: "541512",
  setAside: "",
  stage: "identified",
  valueLow: "",
  valueHigh: "",
  createdAt: new Date("2026-09-10T00:00:00Z"),
  awardDate: null,
  updatedAt: new Date("2026-09-20T00:00:00Z"),
  ...o,
});

const rows: ReportOpp[] = [
  opp({ agency: "GSA", stage: "won", valueHigh: "$2M", awardDate: new Date("2026-09-15T00:00:00Z") }),
  opp({ agency: "GSA", stage: "lost" }),
  opp({ agency: "GSA", stage: "no_bid" }),
  opp({ agency: "Navy", stage: "won", valueLow: "500k", updatedAt: new Date("2026-08-02T00:00:00Z") }),
  opp({ agency: "", stage: "lost", setAside: "SDVOSB" }),
  opp({ agency: "Navy", stage: "writing", valueHigh: "1.5M" }),
  opp({ agency: "Army", stage: "capture", createdAt: new Date("2024-01-05T00:00:00Z") }),
];

describe("winRateBy", () => {
  it("counts won ÷ (won + lost), no-bids beside it, blanks as (not set), busiest first", () => {
    expect(winRateBy(rows, "agency")).toEqual([
      { key: "GSA", decided: 2, won: 1, lost: 1, noBid: 1, winRate: 0.5, wonValue: 2_000_000 },
      { key: "(not set)", decided: 1, won: 0, lost: 1, noBid: 0, winRate: 0, wonValue: 0 },
      { key: "Navy", decided: 1, won: 1, lost: 0, noBid: 0, winRate: 1, wonValue: 500_000 },
    ]);
    expect(winRateBy(rows, "setAside").map((r) => r.key)).toEqual(["(not set)", "SDVOSB"]);
    expect(winRateBy([opp({ stage: "no_bid" })], "agency")[0]).toMatchObject({ decided: 0, winRate: null });
  });
});

describe("stageFunnel", () => {
  it("reads lost as reaching submitted and no-bid as leaving at qualification", () => {
    expect(stageReached("lost")).toBe(6);
    expect(stageReached("no_bid")).toBe(2);
    expect(stageReached("won")).toBe(7);
    const f = stageFunnel(rows);
    expect(f.map((x) => x.reached)).toEqual([7, 7, 7, 6, 5, 5, 4, 2]);
    expect(f[0]!.conversion).toBeNull();
    expect(f[3]).toMatchObject({ stage: "capture", current: 1, reached: 6, conversion: 6 / 7 });
    expect(f[7]).toMatchObject({ stage: "won", current: 2, conversion: 0.5 });
  });
});

describe("monthlySeries", () => {
  it("buckets created and won by calendar month, oldest first", () => {
    const m = monthlySeries(rows, NOW, 3);
    expect(m.map((x) => x.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(m[1]).toMatchObject({ month: "2026-09", created: 6, won: 1, wonValue: 2_000_000 });
    expect(m[0]).toMatchObject({ created: 0, won: 1, wonValue: 500_000 });
    expect(m[2]).toMatchObject({ created: 0, won: 0 });
  });
});

describe("summary and range", () => {
  it("totals the headline numbers", () => {
    expect(reportSummary(rows)).toEqual({ total: 7, open: 2, won: 2, lost: 2, noBid: 1, winRate: 0.5, openValue: 1_500_000, wonValue: 2_500_000 });
    expect(formatRate(0.5)).toBe("50%");
    expect(formatRate(null)).toBe("—");
  });

  it("windows the tables by when opportunities were created", () => {
    expect(parseReportRange("24m")).toBe("24m");
    expect(parseReportRange("bogus")).toBe("12m");
    expect(rangeStart("12m", NOW)).toEqual(new Date("2025-11-01T00:00:00Z"));
    expect(rangeStart("all", NOW)).toBeNull();
    expect(buildReport(rows, "12m", NOW).summary.total).toBe(6);
    expect(buildReport(rows, "all", NOW).summary.total).toBe(7);
    expect(buildReport(rows, "12m", NOW).months).toHaveLength(12);
  });
});
