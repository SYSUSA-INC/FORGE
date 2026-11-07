/**
 * BL-NAV-LIFECYCLE phase 2a — the Evaluate decision's pure rules: what a
 * GO / NO-GO / PARTNER needs, where it takes the opportunity, its note,
 * and the Evaluate list's filters.
 */
import { describe, expect, it } from "vitest";
import {
  checkDecision,
  daysLeft,
  DECISION_STAGE,
  decisionNote,
  decisionReadiness,
  evaluateFilter,
  matchesEvaluateFilter,
  NO_GO_REASON_MIN,
} from "@/lib/opportunity-decision";

describe("checkDecision", () => {
  it("takes GO and PARTNER with or without a note", () => {
    expect(checkDecision({ decision: "go" })).toEqual({ ok: true, decision: "go", category: "", reason: "" });
    expect(checkDecision({ decision: "partner", reason: "  need a cleared SOC  ", category: "price" })).toEqual({ ok: true, decision: "partner", category: "", reason: "need a cleared SOC" });
  });

  it("refuses anything that isn't one of the three, including object keys", () => {
    for (const d of ["", "advance", "toString", "__proto__", "constructor"]) expect(checkDecision({ decision: d }).ok).toBe(false);
  });

  it("needs a NO-GO category and a reason in the team's own words", () => {
    const words = "The incumbent has held it for ten years.";
    expect(checkDecision({ decision: "no_go", reason: words })).toEqual({ ok: false, error: "Choose why it's a NO-GO." });
    expect(checkDecision({ decision: "no_go", category: "nonsense", reason: words }).ok).toBe(false);
    const short = checkDecision({ decision: "no_go", category: "competition", reason: "x".repeat(NO_GO_REASON_MIN - 1) });
    expect(short.ok).toBe(false);
    expect(checkDecision({ decision: "no_go", category: "competition", reason: `  ${words}  ` })).toEqual({ ok: true, decision: "no_go", category: "competition", reason: words });
  });

  it("caps a reason's length", () => {
    const r = checkDecision({ decision: "go", reason: "a".repeat(5000) });
    expect(r.ok && r.reason.length).toBe(4000);
  });
});

describe("where a decision takes the opportunity", () => {
  it("GO and PARTNER go to Capture (Qualified), NO-GO closes it", () => {
    expect(DECISION_STAGE).toEqual({ go: "qualification", partner: "qualification", no_go: "no_bid" });
  });

  it("leaves a readable note", () => {
    expect(decisionNote({ decision: "no_go", category: "timing", reason: "Due in three days with no draft." })).toBe("Decision: NO-GO. Reason: Not enough time. Due in three days with no draft.");
    expect(decisionNote({ decision: "go", category: "", reason: "" })).toBe("Decision: GO.");
  });
});

describe("the Evaluate list", () => {
  it("says what a row still needs", () => {
    expect(decisionReadiness({ analysed: false, matrixBuilt: false })).toMatch(/Analyze it and build/);
    expect(decisionReadiness({ analysed: true, matrixBuilt: false })).toMatch(/capability matrix/);
    expect(decisionReadiness({ analysed: false, matrixBuilt: true })).toBe("Analyze it first");
    expect(decisionReadiness({ analysed: true, matrixBuilt: true })).toBeNull();
  });

  it("filters by what is missing", () => {
    const none = { analysed: false, matrixBuilt: false };
    const both = { analysed: true, matrixBuilt: true };
    const analysedOnly = { analysed: true, matrixBuilt: false };
    expect(evaluateFilter("ready")).toBe("ready");
    expect(evaluateFilter("bogus")).toBe("all");
    expect(evaluateFilter(undefined)).toBe("all");
    expect([none, both, analysedOnly].filter((r) => matchesEvaluateFilter(r, "needs_analysis"))).toEqual([none]);
    expect([none, both, analysedOnly].filter((r) => matchesEvaluateFilter(r, "needs_matrix"))).toEqual([none, analysedOnly]);
    expect([none, both, analysedOnly].filter((r) => matchesEvaluateFilter(r, "ready"))).toEqual([both]);
    expect([none, both, analysedOnly].filter((r) => matchesEvaluateFilter(r, "all"))).toHaveLength(3);
  });

  it("counts the days left", () => {
    const now = new Date("2026-11-06T12:00:00Z");
    expect(daysLeft("2026-11-10T12:00:00Z", now)).toBe(4);
    expect(daysLeft("2026-11-05T12:00:00Z", now)).toBe(-1);
    expect(daysLeft(null, now)).toBeNull();
    expect(daysLeft("not a date", now)).toBeNull();
  });
});
