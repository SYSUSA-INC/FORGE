import { describe, expect, it } from "vitest";
import {
  CAPABILITY_TEAMING_THRESHOLD,
  capabilityPwinFeature,
  computeCapabilityCoverage,
} from "@/lib/capability-coverage";
import type { CapabilityAnswer, CapabilityQuestion } from "@/lib/capability-matrix-types";

const q = (id: string, kind: CapabilityQuestion["kind"], refs: string[] = []): CapabilityQuestion => ({
  id,
  text: `Question ${id}`,
  refs,
  kind,
  area: "Test",
});
const a = (value: CapabilityAnswer["value"], partnerCompanyId: string | null = null): CapabilityAnswer => ({
  value,
  evidence: "",
  partnerCompanyId,
  updatedAt: "2026-10-25T00:00:00Z",
  updatedByUserId: "u1",
});

describe("computeCapabilityCoverage", () => {
  it("weights answers and kinds, and leaves N/A and unanswered questions out", () => {
    const qs = [q("s1", "standing"), q("q1", "shall", ["C.1"]), q("q2", "should"), q("q3", "may"), q("q4", "shall")];
    const c = computeCapabilityCoverage(qs, {
      s1: a("have_proven"), // 1 × 1
      q1: a("partial"), // 1 × 0.5
      q2: a("have_unproven"), // 0.5 × 0.75
      q3: a("na"), // excluded
      // q4 unanswered
    });
    expect(c.total).toBe(5);
    expect(c.answered).toBe(4);
    expect(c.applicable).toBe(3);
    expect(c.coverage).toBeCloseTo((1 + 0.5 + 0.375) / 2.5);
    expect(c.shallCoverage).toBeCloseTo(0.75);
    expect(c.gaps).toEqual([]);
    expect(c.partnerNeeded).toBe(false);
  });

  it("returns null coverage with nothing answered", () => {
    const c = computeCapabilityCoverage([q("q1", "shall")], {});
    expect(c.coverage).toBeNull();
    expect(c.partnerNeeded).toBe(false);
  });

  it("flags a partner on any shall-level partner gap, and counts a named partner as partial cover", () => {
    const qs = [q("q1", "shall", ["C.1"]), q("q2", "shall"), q("q3", "should")];
    const open = computeCapabilityCoverage(qs, { q1: a("gap_partner"), q2: a("have_proven"), q3: a("have_proven") });
    expect(open.partnerNeeded).toBe(true);
    expect(open.shallGapsOpen).toBe(1);
    expect(open.partnerCovered).toBe(0);
    expect(open.gaps[0]).toMatchObject({ questionId: "q1", refs: ["C.1"], value: "gap_partner", partnerNamed: false });

    const named = computeCapabilityCoverage(qs, { q1: a("gap_partner", "co-1"), q2: a("have_proven"), q3: a("have_proven") });
    expect(named.partnerNeeded).toBe(true);
    expect(named.shallGapsOpen).toBe(0);
    expect(named.partnerCovered).toBe(1);
    expect(named.shallCoverage).toBeCloseTo((0.6 + 1) / 2);
  });

  it("flags a partner when shall coverage falls under the threshold even without a partner gap", () => {
    const qs = [q("q1", "shall"), q("q2", "shall"), q("q3", "shall")];
    const c = computeCapabilityCoverage(qs, { q1: a("gap_none"), q2: a("partial"), q3: a("have_proven") });
    expect(c.shallCoverage).toBeCloseTo(0.5);
    expect(c.shallCoverage!).toBeLessThan(CAPABILITY_TEAMING_THRESHOLD);
    expect(c.partnerNeeded).toBe(true);
    expect(c.shallGapsOpen).toBe(1);
  });
});

describe("capabilityPwinFeature", () => {
  const qs = Array.from({ length: 10 }, (_, i) => q(`q${i + 1}`, "shall"));
  it("is null until at least 5 questions and 60% of them are answered", () => {
    const four = Object.fromEntries(qs.slice(0, 4).map((x) => [x.id, a("have_proven")]));
    expect(capabilityPwinFeature(computeCapabilityCoverage(qs, four))).toBeNull();
    const five = Object.fromEntries(qs.slice(0, 5).map((x) => [x.id, a("have_proven")]));
    expect(capabilityPwinFeature(computeCapabilityCoverage(qs, five))).toBeNull();
    const six = Object.fromEntries(qs.slice(0, 6).map((x) => [x.id, a("have_proven")]));
    expect(capabilityPwinFeature(computeCapabilityCoverage(qs, six))).toMatchObject({ coverage: 1, answered: 6, total: 10 });
  });
});
