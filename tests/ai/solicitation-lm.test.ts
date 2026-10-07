/**
 * BL-AIX Phase 2b — Sections L and M as structured data: what each pass
 * reads, how the model's answer is cleaned, where each item sits, and
 * what the outline and the accuracy check take from it.
 */
import { describe, expect, it } from "vitest";
import { createLocator } from "@/lib/requirement-provenance";
import {
  describeLmForOutline,
  lmExcerpt,
  lmScoringInputs,
  locateLm,
  mergeLmStructures,
  normalizeSectionL,
  normalizeSectionM,
  parsePageLimit,
} from "@/lib/solicitation-lm";
import { segmentSolicitation } from "@/lib/solicitation-segments";
import { ucfSolicitation } from "../helpers/ucf-solicitation";

describe("BL-AIX Phase 2b — reading Sections L and M", () => {
  it("reads each section from its own heading, and falls back to locating it", () => {
    const { text } = ucfSolicitation();
    const segments = segmentSolicitation(text);
    const l = lmExcerpt(text, segments, "L")!;
    expect(l.text.startsWith("SECTION L - INSTRUCTIONS")).toBe(true);
    expect(l.text).not.toContain("SECTION M");
    expect(l.label).toBe("Section L — Instructions, conditions and notices to offerors");
    expect(lmExcerpt(text, segments, "M")!.text.startsWith("SECTION M - EVALUATION FACTORS")).toBe(true);

    // No UCF headings at line start: locateSection still finds the evaluation factors.
    const prose =
      "Cover letter. " +
      "Evaluation factors for award: proposals will be evaluated on technical approach and past performance; the factors are of equal importance and the evaluation uses a best value tradeoff with adjectival ratings. ".repeat(3);
    const m = lmExcerpt(prose, segmentSolicitation(prose), "M")!;
    expect(m.text.startsWith("Evaluation factors for award")).toBe(true);
    expect(lmExcerpt("The contractor shall report monthly.", [], "L")).toBeNull();
  });

  it("reads page limits from numbers or words", () => {
    expect(parsePageLimit(25)).toBe(25);
    expect(parsePageLimit("30")).toBe(30);
    expect(parsePageLimit(null, "shall not exceed twenty-five (25) pages")).toBe(25);
    expect(parsePageLimit(null, "no limit")).toBeNull();
    expect(parsePageLimit(0)).toBeNull();
  });

  it("cleans Section L and drops an empty answer", () => {
    const l = normalizeSectionL({
      volumes: [
        { name: " Volume I  - Technical ", pageLimit: null, pageLimitText: "shall not exceed 25 pages", contents: "Technical approach.", quote: "Volume I shall not exceed 25 pages" },
        { name: "", pageLimit: 5, pageLimitText: "", contents: "", quote: "" },
      ],
      formatRules: [{ rule: "12-point Times New Roman", quote: "in 12-point Times New Roman" }, { rule: "", quote: "x" }],
      submission: [],
    })!;
    expect(l.volumes).toEqual([
      { name: "Volume I - Technical", pageLimit: 25, pageLimitText: "shall not exceed 25 pages", contents: "Technical approach.", quote: "Volume I shall not exceed 25 pages" },
    ]);
    expect(l.formatRules).toHaveLength(1);
    expect(normalizeSectionL({ volumes: [], formatRules: [], submission: [] })).toBeNull();
    expect(normalizeSectionL(null)).toBeNull();
  });

  it("keeps Section M's factors in order and an unknown basis as unstated", () => {
    const m = normalizeSectionM({
      basis: "best value",
      basisQuote: "",
      relativeImportance: "Technical is more important than past performance.",
      factors: [
        { name: "Technical Approach", importance: "most important", quote: "Technical approach", subfactors: [{ name: "Staffing", importance: "" }, { name: "", importance: "x" }] },
        { name: "Past Performance", importance: "", quote: "", subfactors: [] },
      ],
    })!;
    expect(m.basis).toBe("unstated");
    expect(m.factors.map((f) => f.name)).toEqual(["Technical Approach", "Past Performance"]);
    expect(m.factors[0]!.subfactors).toEqual([{ name: "Staffing", importance: "" }]);
    expect(normalizeSectionM({ basis: "unstated", factors: [] })).toBeNull();
    expect(normalizeSectionM({ basis: "lpta", factors: [] })).toMatchObject({ basis: "lpta", factors: [] });
  });
});

describe("BL-AIX Phase 2b — using Sections L and M", () => {
  const { text, pageStarts } = ucfSolicitation();
  const located = locateLm(
    {
      sectionL: {
        volumes: [{ name: "Volume I", pageLimit: 25, pageLimitText: "shall not exceed 25 pages", contents: "", quote: "Volume I shall not exceed 25 pages in 12-point Times New Roman." }],
        formatRules: [{ rule: "12-point font", quote: "" }],
        submission: [],
      },
      sectionM: {
        basis: "tradeoff",
        basisQuote: "",
        relativeImportance: "",
        factors: [{ name: "Technical approach", importance: "more important than past performance", quote: "Technical approach is more important than past performance.", subfactors: [] }],
      },
    },
    createLocator(text, { pageStarts }),
  );

  it("locates each quoted item on its page and in its section", () => {
    expect(located.sectionL!.volumes[0]!.source).toMatchObject({ quote: "exact", page: 4, section: "L", paragraph: "L.5" });
    expect(located.sectionL!.formatRules[0]!.source).toBeUndefined();
    expect(located.sectionM!.factors[0]!.source).toMatchObject({ quote: "exact", page: 4, section: "M", paragraph: "M.1" });
  });

  it("takes the newest document's L and M, gives the outline its page limits and the accuracy check its inputs", () => {
    const older = { sectionL: null, sectionM: { basis: "lpta" as const, basisQuote: "", relativeImportance: "", factors: [] } };
    const merged = mergeLmStructures([{ sectionL: located.sectionL }, null, older]);
    expect(merged.sectionL).toBe(located.sectionL);
    expect(merged.sectionM?.basis).toBe("lpta");

    const outline = describeLmForOutline({ ...located });
    expect(outline).toContain("- Volume I: 25 pages (p. 4)");
    expect(outline).toContain("1. Technical approach (more important than past performance)");
    expect(describeLmForOutline({})).toBe("");

    const inputs = lmScoringInputs({ ...located });
    expect(inputs.factors).toEqual(["Technical approach"]);
    expect(inputs.sectionL).toContain("Volume I shall not exceed 25 pages in 12-point Times New Roman.");
    expect(lmScoringInputs(null)).toEqual({ sectionL: [], factors: [] });
  });
});
