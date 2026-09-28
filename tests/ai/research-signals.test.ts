/**
 * BL-AIP-6 — research-rail heuristics.
 */
import { describe, expect, it } from "vitest";
import {
  coverageScore,
  distinctiveTerms,
  focusParagraph,
  itemsNotCovered,
  shouldRefresh,
} from "@/lib/research-signals";

describe("BL-AIP-6 — coverage", () => {
  it("extracts distinctive terms and ignores stopwords", () => {
    const terms = distinctiveTerms("The contractor shall provide monthly status reports to the COR.");
    expect(terms).toContain("monthly");
    expect(terms).toContain("report");
    expect(terms).not.toContain("contractor");
    expect(terms).not.toContain("shall");
  });

  it("scores how much of a clause the draft already covers", () => {
    const clause = "The offeror shall describe its staffing approach for surge periods.";
    expect(coverageScore("Our staffing plan covers surge periods with a bench.", clause)).toBeGreaterThan(0.5);
    expect(coverageScore("We use Kubernetes.", clause)).toBe(0);
    expect(coverageScore("anything", "the and for")).toBe(1);
  });

  it("lists uncovered items least-covered first and caps the list", () => {
    const draft = "We provide monthly status reports and a named transition lead.";
    const items = [
      { id: "a", text: "Provide monthly status reports to the COR." },
      { id: "b", text: "Identify key personnel by name with resumes." },
      { id: "c", text: "Maintain FedRAMP Moderate authorization for the platform." },
      { id: "d", text: "Deliver a transition-in plan naming the transition lead." },
    ];
    const out = itemsNotCovered(draft, items, { max: 2 });
    expect(out.map((i) => i.id)).toEqual(expect.arrayContaining(["b", "c"]));
    expect(out).toHaveLength(2);
    expect(out[0]!.coverage).toBeLessThanOrEqual(out[1]!.coverage);
    expect(out[0]!.missingTerms.length).toBeGreaterThan(0);
  });
});

describe("BL-AIP-6 — focus and refresh", () => {
  it("finds the paragraph being edited, else the last one", () => {
    expect(focusParagraph("A.\n\nB.\n\nC.", "A.\n\nB2.\n\nC.")).toBe("B2.");
    expect(focusParagraph("", "A.\n\nB.")).toBe("A.");
    expect(focusParagraph("A.\n\nB.", "A.\n\nB.")).toBe("B.");
    expect(focusParagraph("", "")).toBe("");
  });

  it("refreshes only on meaningful movement", () => {
    const base = "x".repeat(100) + "\n\n" + "y".repeat(100);
    expect(shouldRefresh(base, base)).toBe(false);
    expect(shouldRefresh("", "short")).toBe(false);
    expect(shouldRefresh(base, base + " " + "z".repeat(50))).toBe(true);
  });
});
