/**
 * BL-FB-SOL-CUSTOMER-PATTERN — tests for the pure customer summary.
 */

import { describe, expect, it } from "vitest";
import {
  agencyMatches,
  formatMoney,
  summarizeCustomerHistory,
  summarizeMarket,
  type CustomerPursuitRow,
  type CustomerSolicitationRow,
} from "@/lib/customer-patterns";

let seq = 0;
function pursuit(over: Partial<CustomerPursuitRow>): CustomerPursuitRow {
  seq += 1;
  return {
    opportunityId: `o${seq}`,
    title: `Opp ${seq}`,
    stage: "capture",
    naicsCode: "",
    setAside: "",
    estimateMid: null,
    outcome: null,
    awardedTo: "",
    awardValue: null,
    decidedAt: null,
    ...over,
  };
}
function sol(over: Partial<CustomerSolicitationRow>): CustomerSolicitationRow {
  seq += 1;
  return {
    id: `s${seq}`,
    title: `Sol ${seq}`,
    solicitationNumber: `N-${seq}`,
    naicsCode: "",
    setAside: "",
    sectionMSummary: "",
    responseDueDate: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("customer patterns — helpers", () => {
  it("agencyMatches folds case/punctuation and allows containment with a floor", () => {
    expect(agencyMatches("Department of Homeland Security", "department of homeland security")).toBe(true);
    expect(agencyMatches("Dept. of Homeland Security", "Homeland Security")).toBe(true);
    expect(agencyMatches("Department of the Air Force", "Air Force")).toBe(true);
    expect(agencyMatches("VA", "Veterans Affairs")).toBe(false); // too short to contain
    expect(agencyMatches("FAA", "FAA")).toBe(true);
    expect(agencyMatches("", "FAA")).toBe(false);
  });

  it("formatMoney abbreviates and handles empties", () => {
    expect(formatMoney(1_250_000)).toBe("$1.3M");
    expect(formatMoney(850_000)).toBe("$850K");
    expect(formatMoney(2_000_000_000)).toBe("$2.0B");
    expect(formatMoney(420)).toBe("$420");
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(0)).toBe("—");
  });
});

describe("customer patterns — summary", () => {
  it("summarises an empty history", () => {
    const h = summarizeCustomerHistory({ agency: "FAA", pursuits: [], solicitations: [] });
    expect(h).toMatchObject({
      agency: "FAA",
      pursuits: 0,
      won: 0,
      lost: 0,
      open: 0,
      winRate: null,
      solicitationsSeen: 0,
      avgEstimate: null,
      avgAward: null,
    });
    expect(h.winners).toEqual([]);
    expect(h.evaluatorPriorities).toEqual([]);
  });

  it("computes record, mixes, averages, winners and recent pursuits", () => {
    const h = summarizeCustomerHistory({
      agency: "FAA",
      pursuits: [
        pursuit({ stage: "won", outcome: "won", naicsCode: "541512", setAside: "8(a)", estimateMid: 1_000_000, awardValue: 900_000, decidedAt: "2026-05-01T00:00:00Z" }),
        pursuit({ stage: "lost", outcome: "lost", naicsCode: "541512", setAside: "8(a)", estimateMid: 3_000_000, awardValue: 2_500_000, awardedTo: "Acme Federal", decidedAt: "2026-06-01T00:00:00Z" }),
        pursuit({ stage: "lost", outcome: "lost", naicsCode: "541330", awardedTo: "ACME FEDERAL, INC.", decidedAt: "2026-07-01T00:00:00Z" }),
        pursuit({ stage: "capture", naicsCode: "541512" }),
        pursuit({ stage: "no_bid" }),
      ],
      solicitations: [
        sol({ sectionMSummary: "Best value; technical approach most important.", createdAt: "2026-02-01T00:00:00Z" }),
        sol({ sectionMSummary: "", createdAt: "2026-03-01T00:00:00Z" }),
        sol({ sectionMSummary: "LPTA.", createdAt: "2025-12-01T00:00:00Z" }),
      ],
    });
    expect(h.pursuits).toBe(5);
    expect(h.won).toBe(1);
    expect(h.lost).toBe(2);
    expect(h.open).toBe(1); // capture only; no_bid is terminal
    expect(h.winRate).toBeCloseTo(1 / 3, 5);
    expect(h.solicitationsSeen).toBe(3);
    expect(h.naicsMix).toEqual([
      { code: "541512", count: 3 },
      { code: "541330", count: 1 },
    ]);
    expect(h.setAsideMix).toEqual([{ setAside: "8(a)", count: 2 }]);
    expect(h.avgEstimate).toBe(2_000_000);
    expect(h.avgAward).toBe(1_700_000);
    expect(h.winners).toEqual([{ name: "Acme Federal", count: 2 }]);
    // Newest first, blanks skipped, capped at 3.
    expect(h.evaluatorPriorities.map((e) => e.summary)).toEqual([
      "Best value; technical approach most important.",
      "LPTA.",
    ]);
    expect(h.recentPursuits.map((p) => p.outcome)).toEqual(["lost", "lost", "won", null, null]);
  });

  it("summarizeMarket rolls awards up by recipient", () => {
    const m = summarizeMarket(
      [
        { recipientName: "Booz Allen Hamilton Inc", amount: 5_000_000 },
        { recipientName: "BOOZ ALLEN HAMILTON", amount: 3_000_000 },
        { recipientName: "Acme", amount: 1_000_000 },
        { recipientName: "", amount: 250_000 },
      ],
      5,
    );
    expect(m.awards).toBe(4);
    expect(m.totalObligated).toBe(9_250_000);
    expect(m.topRecipients[0]).toEqual({ name: "Booz Allen Hamilton Inc", amount: 8_000_000, awards: 2 });
    expect(m.topRecipients[1]).toEqual({ name: "Acme", amount: 1_000_000, awards: 1 });
    expect(m.yearsBack).toBe(5);
  });
});
