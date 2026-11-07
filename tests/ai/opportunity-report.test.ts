/**
 * BL-NAV-LIFECYCLE 2b-2 — the Matrix Report snapshot: every requirement
 * with its answer, percentage, evidence and partner, the coverage, the
 * gaps and the partner call. Pure.
 */
import { describe, expect, it } from "vitest";
import { asMatrixReport, buildMatrixReport } from "@/lib/opportunity-report";
import type { CapabilityAnswer, CapabilityAnswerValue, CapabilityQuestion } from "@/lib/capability-matrix-types";

const q = (id: string, area: string, kind: CapabilityQuestion["kind"] = "shall"): CapabilityQuestion => ({ id, text: `Q ${id}`, refs: [`C.${id}`], kind, area });
const a = (value: CapabilityAnswerValue, extra: Partial<CapabilityAnswer> = {}): CapabilityAnswer => ({ value, evidence: "", partnerCompanyId: null, updatedAt: "", updatedByUserId: "", ...extra });
const opportunity = { title: "Help desk", agency: "VA", solicitationNumber: "36C1", naics: "541512", dueDate: null };

describe("buildMatrixReport", () => {
  const body = buildMatrixReport({
    opportunity,
    questions: [q("1", "Service"), q("2", "Migration"), q("3", "Security"), q("4", "Security")],
    answers: {
      "1": a("have_proven", { evidence: "VA OIT help desk, 2023" }),
      "2": a("partial", { percent: 70 }),
      "3": a("gap_partner", { partnerCompanyId: "c1" }),
    },
    partnerNames: { c1: "Alpha Partner" },
    now: new Date("2026-11-07T12:00:00Z"),
  });

  it("keeps each requirement with its answer, percentage, evidence and partner", () => {
    expect(body.rows.map((r) => [r.id, r.answer, r.label, r.percent, r.partner])).toEqual([
      ["1", "yes", "Yes, proven", null, null],
      ["2", "partial", "Partial, 70%", 70, null],
      ["3", "no", "No, a partner could cover it", null, "Alpha Partner"],
      ["4", null, "Not answered", null, null],
    ]);
    expect(body.rows[0]!.evidence).toBe("VA OIT help desk, 2023");
  });

  it("carries the coverage, counts, gaps and partner call of the moment", () => {
    // (1 + 0.7 + 0.6 named partner) / 3 answered
    expect(body.coverage).toBeCloseTo((1 + 0.7 + 0.6) / 3);
    expect(body.counts).toEqual({ yes: 1, partial: 1, no: 1, na: 0, unanswered: 1 });
    expect(body.gaps).toEqual([{ text: "Q 3", refs: ["C.3"], partner: "Alpha Partner" }]);
    expect(body.partnerNeeded).toBe(true);
    expect(body.generatedAt).toBe("2026-11-07T12:00:00.000Z");
  });

  it("reads a saved body back, and refuses anything else", () => {
    expect(asMatrixReport(JSON.parse(JSON.stringify(body)))?.rows).toHaveLength(4);
    expect(asMatrixReport({ kind: "analysis" })).toBeNull();
    expect(asMatrixReport(null)).toBeNull();
  });
});
