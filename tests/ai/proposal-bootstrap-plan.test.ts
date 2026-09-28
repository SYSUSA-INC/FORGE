/**
 * BL-AIP-5b — proposal bootstrap from Section L, pure parts.
 */

import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_MAX_SECTIONS,
  inferSectionKind,
  normalizeBootstrapPlan,
  outlineRequirements,
  planSectionsForRebuild,
  sectionLWindow,
  sectionTitleKey,
} from "@/lib/proposal-bootstrap-plan";

describe("normalizeBootstrapPlan", () => {
  it("cleans titles, infers kinds, bounds page limits and de-duplicates", () => {
    const plan = normalizeBootstrapPlan({
      sections: [
        { title: "  Volume I — Technical  Approach ", kind: "technical", pageLimit: 25.4, instructions: "Describe the approach.", sourceRef: "L.4.2" },
        { title: "Volume I – Technical Approach", kind: "technical", pageLimit: 25 },
        { title: "Past Performance", kind: "bogus", pageLimit: 0, instructions: "" },
        { title: "Price Volume", pageLimit: null },
        { title: "", kind: "pricing" },
      ],
      dueDate: "2026-11-03",
      proposedThemes: [
        { title: "Proven transition", statement: "We cut over in 30 days.", rationale: "Factor 2" },
        { title: "No statement" },
      ],
      notes: "Times New Roman 12 pt.",
    });
    expect(plan.sections.map((s) => [s.title, s.kind, s.pageLimit])).toEqual([
      ["Volume I — Technical Approach", "technical", 25],
      ["Past Performance", "past_performance", null],
      ["Price Volume", "pricing", null],
    ]);
    expect(plan.sections[0]!.instructions).toBe("Describe the approach.");
    expect(plan.dueDate).toBe("2026-11-03");
    expect(plan.proposedThemes).toEqual([
      { title: "Proven transition", statement: "We cut over in 30 days.", rationale: "Factor 2" },
    ]);
    expect(plan.notes).toBe("Times New Roman 12 pt.");
  });

  it("rejects bad dates, caps the section count and survives an empty answer", () => {
    expect(normalizeBootstrapPlan({ dueDate: "next Friday" }).dueDate).toBeNull();
    expect(normalizeBootstrapPlan({ dueDate: "2026-02-30" }).dueDate).toBeNull();
    const many = normalizeBootstrapPlan({
      sections: Array.from({ length: 30 }, (_, i) => ({ title: `Tab ${i} Section ${i}`, kind: "technical" })),
    });
    expect(many.sections).toHaveLength(BOOTSTRAP_MAX_SECTIONS);
    expect(normalizeBootstrapPlan(null)).toEqual({ sections: [], dueDate: null, proposedThemes: [], notes: "" });
  });
});

describe("inferSectionKind / sectionTitleKey", () => {
  it("maps common volume names and strips numbering for matching", () => {
    expect(inferSectionKind("Executive Summary")).toBe("executive_summary");
    expect(inferSectionKind("Volume III — Past Performance")).toBe("past_performance");
    expect(inferSectionKind("Price/Cost Volume")).toBe("pricing");
    expect(inferSectionKind("Cross-Reference Matrix")).toBe("compliance");
    expect(inferSectionKind("Staffing and Transition Plan")).toBe("management");
    expect(inferSectionKind("Cybersecurity Solution")).toBe("technical");
    expect(sectionTitleKey("Volume II: Technical Approach")).toBe(sectionTitleKey("technical approach"));
    expect(sectionTitleKey("Tab C - Past Performance")).toBe("pastperformance");
  });
});

describe("planSectionsForRebuild", () => {
  const existing = [
    { id: "a", title: "Executive Summary", wordCount: 0, pageLimit: null, instructions: "" },
    { id: "b", title: "Technical Approach", wordCount: 800, pageLimit: 10, instructions: "old" },
    { id: "c", title: "Management Approach", wordCount: 0, pageLimit: null, instructions: "" },
    { id: "d", title: "Pricing Notes", wordCount: 120, pageLimit: null, instructions: "" },
  ];
  const planned = [
    { title: "Volume I: Technical Approach", kind: "technical" as const, pageLimit: 25, instructions: "new brief", sourceRef: "L.4" },
    { title: "Volume II: Past Performance", kind: "past_performance" as const, pageLimit: null, instructions: "three refs", sourceRef: "L.5" },
    { title: "Executive Summary", kind: "executive_summary" as const, pageLimit: null, instructions: "", sourceRef: "" },
  ];

  it("updates matches, inserts new sections, removes empty leftovers and keeps written ones", () => {
    const diff = planSectionsForRebuild(existing, planned);
    expect(diff.update).toEqual([
      { id: "b", pageLimit: 25, instructions: "new brief", ordering: 1 },
      { id: "a", pageLimit: null, instructions: "", ordering: 3 },
    ]);
    expect(diff.insert.map((s) => [s.title, s.ordering])).toEqual([["Volume II: Past Performance", 2]]);
    expect(diff.remove).toEqual(["c"]);
    expect(diff.keep).toEqual([{ id: "d", ordering: 4 }]);
  });

  it("keeps an existing cap when the plan has none", () => {
    const diff = planSectionsForRebuild(
      [{ id: "b", title: "Technical Approach", wordCount: 5, pageLimit: 10, instructions: "old" }],
      [{ title: "Technical Approach", kind: "technical", pageLimit: null, instructions: "", sourceRef: "" }],
    );
    expect(diff.update).toEqual([{ id: "b", pageLimit: 10, instructions: "old", ordering: 1 }]);
  });
});

describe("sectionLWindow", () => {
  it("prefers the real instructions over the table-of-contents mention", () => {
    const toc = "TABLE OF CONTENTS\nSection L Instructions ......... 40\nSection M Evaluation ........ 55\n";
    const body = "SECTION L — INSTRUCTIONS TO OFFERORS\nL.1 The offeror shall submit three volumes. " + "x".repeat(2_500);
    const text = toc + "filler ".repeat(200) + body;
    const win = sectionLWindow(text, 200);
    expect(win).toContain("INSTRUCTIONS TO OFFERORS");
    expect(win).not.toContain("TABLE OF CONTENTS");
  });

  it("falls back to the first mention and to nothing", () => {
    expect(sectionLWindow("Section L is short.")).toContain("Section L");
    expect(sectionLWindow("No instructions here.")).toBe("");
    expect(sectionLWindow("")).toBe("");
  });
});

describe("outlineRequirements", () => {
  it("puts submission and format clauses first and caps the list", () => {
    const reqs = [
      { text: "The contractor shall provide help desk support." },
      { text: "Volume I shall not exceed 25 pages." },
      { text: "Offerors shall submit proposals via SAM.gov by the due date." },
      { text: "The contractor shall maintain a risk register." },
    ];
    expect(outlineRequirements(reqs, 3).map((r) => r.text.slice(0, 12))).toEqual([
      "Volume I sha",
      "Offerors sha",
      "The contract",
    ]);
  });
});
