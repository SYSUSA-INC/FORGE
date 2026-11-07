/**
 * BL-NAV-LIFECYCLE 2b (FORGE II E-5 to E-8) — Yes / Partial % / No over
 * the six stored answers, and coverage counting a Partial's percentage.
 */
import { describe, expect, it } from "vitest";
import { computeCapabilityCoverage } from "@/lib/capability-coverage";
import {
  answerLabel,
  clampPartialPercent,
  storedValueOf,
  threeAnswerCounts,
  threeAnswerOf,
  type CapabilityAnswer,
  type CapabilityAnswerValue,
  type CapabilityQuestion,
} from "@/lib/capability-matrix-types";

const q = (id: string, kind: CapabilityQuestion["kind"] = "shall"): CapabilityQuestion => ({ id, text: `Q ${id}`, refs: [], kind, area: "Test" });
const a = (value: CapabilityAnswerValue, percent?: number | null): CapabilityAnswer => ({ value, evidence: "", partnerCompanyId: null, percent, updatedAt: "2026-11-07T00:00:00Z", updatedByUserId: "u" });

describe("three answers over the six stored values", () => {
  it("maps both ways without losing proven or partner", () => {
    const all: CapabilityAnswerValue[] = ["have_proven", "have_unproven", "partial", "gap_partner", "gap_none", "na"];
    for (const v of all) expect(storedValueOf(threeAnswerOf(v))).toBe(v);
    expect(storedValueOf({ answer: "yes" })).toBe("have_unproven");
    expect(storedValueOf({ answer: "yes", proven: true })).toBe("have_proven");
    expect(storedValueOf({ answer: "no", partnerCould: true })).toBe("gap_partner");
    expect(storedValueOf({ answer: "no" })).toBe("gap_none");
  });

  it("keeps a Partial between 5% and 95% in steps of 5", () => {
    expect(clampPartialPercent(62)).toBe(60);
    expect(clampPartialPercent(0)).toBe(5);
    expect(clampPartialPercent(100)).toBe(95);
    expect(clampPartialPercent("abc")).toBe(50);
    expect(clampPartialPercent(undefined)).toBe(50);
  });

  it("reads each answer in words", () => {
    expect(answerLabel(a("have_proven"))).toBe("Yes, proven");
    expect(answerLabel(a("partial", 70))).toBe("Partial, 70%");
    expect(answerLabel(a("partial"))).toBe("Partial, 50%");
    expect(answerLabel(a("gap_partner"))).toBe("No, a partner could cover it");
  });

  it("counts Yes, Partial, No and N/A over the questions still in the set", () => {
    const qs = [q("a"), q("b"), q("c"), q("d")];
    expect(threeAnswerCounts(qs, { a: a("have_proven"), b: a("have_unproven"), c: a("partial", 40), gone: a("gap_none") })).toEqual({ yes: 2, partial: 1, no: 0, na: 0 });
  });
});

describe("coverage counts a Partial's percentage", () => {
  it("uses the percentage, and 50% for older answers without one", () => {
    expect(computeCapabilityCoverage([q("a")], { a: a("partial", 80) }).coverage).toBeCloseTo(0.8);
    expect(computeCapabilityCoverage([q("a")], { a: a("partial", 20) }).shallCoverage).toBeCloseTo(0.2);
    expect(computeCapabilityCoverage([q("a")], { a: a("partial") }).coverage).toBeCloseTo(0.5);
    // A low Partial on a shall requirement now trips the teaming rule (under 70%).
    expect(computeCapabilityCoverage([q("a"), q("b")], { a: a("have_proven"), b: a("partial", 20) }).partnerNeeded).toBe(true);
    expect(computeCapabilityCoverage([q("a"), q("b")], { a: a("have_proven"), b: a("partial", 90) }).partnerNeeded).toBe(false);
  });
});
