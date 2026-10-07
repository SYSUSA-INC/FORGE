/**
 * BL-AIX Phase 1e-3 — the accuracy measures: what counts as finding a
 * gold requirement, page limit or factor, and how a run is summarised.
 */
import { describe, expect, it } from "vitest";
import {
  factorMatches,
  figures,
  matchOneToOne,
  orderAgreement,
  pageLimitCaptured,
  requirementMatches,
  scoreDocument,
  stepsFor,
  summarizeRun,
} from "@/lib/extraction-eval-logic";
import { isSameRequirement } from "@/lib/requirements-text";

describe("BL-AIX Phase 1e-3 — extraction accuracy measures", () => {
  it("matches a trimmed or lightly reworded requirement, but not a different figure or a different obligation", () => {
    const gold = "The contractor shall migrate 40 legacy applications to the FedRAMP High environment within 180 days.";
    expect(requirementMatches(gold, "Migrate 40 legacy applications to the FedRAMP High environment within 180 days.", isSameRequirement)).toBe(true);
    expect(requirementMatches(gold, "The contractor shall migrate 20 legacy applications to the FedRAMP High environment within 180 days.", isSameRequirement)).toBe(false);
    expect(requirementMatches(gold, "The contractor shall provide 24x7 help desk support for all users.", isSameRequirement)).toBe(false);
    expect(figures("Volume I: 25 pages, 12-point, 1.0 inch margins")).toEqual(["25", "12", "1"]);
  });

  it("matches one to one, so one extracted item cannot satisfy two gold items", () => {
    const same = (a: string, b: string) => a === b;
    const { matchedGold, used } = matchOneToOne(["a", "a", "b"], ["a", "c"], same);
    expect(matchedGold).toEqual([true, false, false]);
    expect([...used]).toEqual([0]);
  });

  it("captures a page limit only when the same figures and wording are present", () => {
    const gold = { text: "Volume I Technical shall not exceed 25 pages.", value: "25 pages" };
    expect(pageLimitCaptured(gold, ["The Technical Volume (Volume I) shall not exceed 25 pages."])).toBe(true);
    expect(pageLimitCaptured(gold, ["Volume I Technical shall not exceed 30 pages."])).toBe(false);
    expect(pageLimitCaptured(gold, ["25 key personnel resumes are required."])).toBe(false);
  });

  it("finds factors by name and measures pairwise order agreement", () => {
    expect(factorMatches("Factor 1: Technical Approach", "Technical approach")).toBe(true);
    expect(factorMatches("Past Performance", "Price")).toBe(false);
    expect(orderAgreement([0, 1, 2])).toBe(1);
    expect(orderAgreement([2, 1, 0])).toBe(0);
    expect(orderAgreement([0, 2, 1])).toBeCloseTo(2 / 3);
    expect(orderAgreement([3])).toBeNull();
  });

  it("scores a document, lists what was missed and pools a run by item counts", () => {
    const a = scoreDocument(
      { docId: "a", title: "RFP A", windows: 2, windowsFailed: 0 },
      {
        requirements: ["The contractor shall migrate 40 legacy applications.", "The contractor shall provide 24x7 help desk support."],
        pageLimits: [{ text: "Volume I shall not exceed 25 pages.", value: "25 pages" }],
        factors: ["Technical Approach", "Past Performance", "Price"],
      },
      {
        requirements: ["The contractor shall migrate 40 legacy applications.", "Offerors shall register in SAM."],
        sectionL: ["Volume I shall not exceed 25 pages."],
        factors: ["Past Performance", "Technical Approach"],
      },
      isSameRequirement,
    );
    expect(a).toMatchObject({ requirementRecall: 0.5, requirementPrecision: 0.5, pageLimitCapture: 1, factorRecall: 2 / 3, factorOrder: 0 });
    expect(a.missed).toEqual([
      { kind: "requirement", text: "The contractor shall provide 24x7 help desk support." },
      { kind: "eval_factor", text: "Price" },
    ]);

    const b = scoreDocument(
      { docId: "b", title: "RFI B", windows: 1, windowsFailed: 0 },
      { requirements: ["Respondents shall describe two similar projects."], pageLimits: [], factors: [] },
      { requirements: ["Respondents shall describe two similar projects."], sectionL: [], factors: [] },
      isSameRequirement,
    );
    expect(b).toMatchObject({ requirementRecall: 1, pageLimitCapture: null, factorRecall: null, factorOrder: null });

    expect(summarizeRun([a, b])).toEqual({
      docs: 2,
      requirementRecall: 2 / 3,
      requirementPrecision: 2 / 3,
      pageLimitCapture: 1,
      factorRecall: 2 / 3,
      factorOrder: 0,
    });
    expect(stepsFor(2)).toEqual([{ kind: "window", index: 0 }, { kind: "window", index: 1 }, { kind: "review" }]);
  });
});
