import { describe, expect, it } from "vitest";
import type { CapabilityMatrixCell } from "@/db/schema";
import type { CapabilityAnswer, CapabilityQuestion } from "@/lib/capability-matrix-types";
import {
  acceptAiSuggestions,
  mergeSuggestions,
  pendingSuggestions,
  suggestFromMatrixCells,
  suggestFromPriorAnswers,
} from "@/lib/capability-suggestions";

const NOW = "2026-10-25T12:00:00Z";
const q = (id: string, kind: CapabilityQuestion["kind"], refs: string[] = []): CapabilityQuestion => ({
  id,
  text: `Question ${id}`,
  refs,
  kind,
  area: "Test",
});
const a = (value: CapabilityAnswer["value"], evidence = ""): CapabilityAnswer => ({
  value,
  evidence,
  partnerCompanyId: null,
  updatedAt: "2026-09-01T00:00:00Z",
  updatedByUserId: "u1",
});
const cell = (requirementId: string, status: CapabilityMatrixCell["status"], capabilityRef = "", citation = ""): CapabilityMatrixCell => ({
  requirementId,
  capabilityRef,
  status,
  citation,
  narrative: `narrative ${requirementId}`,
});
const reqs = [
  { id: "R1", sectionRef: "C.1" },
  { id: "R2", sectionRef: "C.2" },
  { id: "R3", sectionRef: "C.3" },
];

describe("suggestFromMatrixCells", () => {
  it("maps a strong cited cell to proven, takes the weakest cell across a question's refs, and cites the strongest", () => {
    const out = suggestFromMatrixCells({
      questions: [q("s1", "standing"), q("q1", "shall", ["C.1"]), q("q2", "shall", ["C.1", "C.2"]), q("q3", "may", ["C.3"]), q("q4", "shall", ["X.9"])],
      requirements: reqs,
      cells: [cell("R1", "strong", "knowledge:k1", "32 apps migrated"), cell("R2", "partial"), cell("R3", "not_addressed")],
      knowledgeTitles: new Map([["k1", "Cloud migration"]]),
      now: NOW,
    });
    expect(out.s1).toBeUndefined(); // standing questions never come from the matrix
    expect(out.q1?.value).toBe("have_proven");
    expect(out.q1?.evidence).toBe("32 apps migrated");
    expect(out.q1?.sources).toEqual([
      { kind: "matrix", ref: "C.1", label: "strong" },
      { kind: "knowledge", ref: "k1", label: "Cloud migration" },
    ]);
    expect(out.q2?.value).toBe("partial"); // weakest of strong + partial
    expect(out.q2?.evidence).toBe("32 apps migrated"); // the strongest cell's citation
    expect(out.q3).toBeUndefined(); // not_addressed says nothing
    expect(out.q4).toBeUndefined(); // ref the review does not have
  });

  it("reads an uncited strong cell as unproven and a gap as a gap with no plan", () => {
    const out = suggestFromMatrixCells({
      questions: [q("q1", "shall", ["C.1"]), q("q2", "shall", ["C.2"])],
      requirements: reqs,
      cells: [cell("R1", "strong"), cell("R2", "gap")],
      knowledgeTitles: new Map(),
      now: NOW,
    });
    expect(out.q1?.value).toBe("have_unproven");
    expect(out.q1?.evidence).toBe("narrative R1");
    expect(out.q2?.value).toBe("gap_none");
  });
});

describe("suggestFromPriorAnswers", () => {
  it("carries only the company-fact standing questions, from the most recent questionnaire that answered them", () => {
    const out = suggestFromPriorAnswers({
      questions: [q("s1", "standing"), q("s2", "standing"), q("s5", "standing"), q("s7", "standing"), q("q1", "shall", ["C.1"])],
      prior: [
        { opportunityId: "o2", title: "Newer bid", answers: { s1: a("have_proven"), s5: a("have_proven", "ISO 9001 cert") } },
        { opportunityId: "o1", title: "Older bid", answers: { s2: a("partial", "Secret FCL"), s5: a("partial") } },
      ],
      now: NOW,
    });
    expect(out.s1).toBeUndefined(); // incumbency is per opportunity
    expect(out.q1).toBeUndefined();
    expect(out.s2?.value).toBe("partial");
    expect(out.s2?.sources).toEqual([{ kind: "prior", ref: "o1", label: "Older bid" }]);
    expect(out.s5?.value).toBe("have_proven");
    expect(out.s5?.evidence).toBe("ISO 9001 cert");
    expect(out.s7).toBeUndefined(); // never answered
  });
});

describe("acceptAiSuggestions", () => {
  it("drops unknown questions and sources, and downgrades proven without a surviving source", () => {
    const allowed = new Map([
      ["pp:p1", { kind: "past_performance" as const, label: "DHS — ITSM" }],
      ["knowledge:k1", { kind: "knowledge" as const, label: "Cloud migration" }],
    ]);
    const out = acceptAiSuggestions({
      parsed: {
        suggestions: [
          { questionId: "q1", value: "have_proven", evidence: "DHS ITSM", reason: "Same work.", sources: ["pp:p1", "pp:nope"] },
          { questionId: "q2", value: "have_proven", evidence: "", reason: "Likely.", sources: ["knowledge:k9"] },
          { questionId: "q3", value: "gap_none", evidence: "", reason: "Never done.", sources: [] },
          { questionId: "q9", value: "partial", evidence: "", reason: "", sources: [] },
          { questionId: "q1", value: "na", evidence: "", reason: "dup", sources: [] },
        ],
      },
      questions: [q("q1", "shall"), q("q2", "shall"), q("q3", "should")],
      allowed,
      now: NOW,
    });
    expect(out.q1?.value).toBe("have_proven");
    expect(out.q1?.sources).toEqual([{ kind: "past_performance", ref: "pp:p1", label: "DHS — ITSM" }]);
    expect(out.q2?.value).toBe("have_unproven");
    expect(out.q2?.sources).toEqual([]);
    expect(out.q3?.value).toBe("gap_none");
    expect(out.q9).toBeUndefined();
  });
  it("accepts the approved company model's capabilities as sources (phase 1c)", () => {
    const out = acceptAiSuggestions({
      parsed: { suggestions: [{ questionId: "q1", value: "have_proven", evidence: "Model: ITSM migration", reason: "Listed as proven.", sources: ["model:itsm-migration"] }] },
      questions: [q("q1", "shall")],
      allowed: new Map([["model:itsm-migration", { kind: "model" as const, label: "Company model: ITSM migration" }]]),
      now: NOW,
    });
    expect(out.q1).toMatchObject({ value: "have_proven", sources: [{ kind: "model", ref: "model:itsm-migration", label: "Company model: ITSM migration" }] });
  });
});

describe("mergeSuggestions and pendingSuggestions", () => {
  it("skips answered questions, lets the earlier layer win, and counts what waits on a person", () => {
    const qs = [q("s2", "standing"), q("q1", "shall"), q("q2", "shall"), q("q3", "shall")];
    const s = (value: CapabilityAnswer["value"]) => ({ value, evidence: "", reason: "", sources: [], suggestedAt: NOW });
    const answers = { q3: a("have_proven") };
    const merged = mergeSuggestions(qs, answers, [
      { q1: s("partial"), q3: s("gap_none") },
      { q1: s("have_proven"), q2: s("have_unproven"), s2: s("partial") },
    ]);
    expect(merged.q1?.value).toBe("partial");
    expect(merged.q2?.value).toBe("have_unproven");
    expect(merged.s2?.value).toBe("partial");
    expect(merged.q3).toBeUndefined();
    expect(pendingSuggestions(qs, answers, merged)).toBe(3);
    expect(pendingSuggestions(qs, { ...answers, q1: a("partial") }, merged)).toBe(2);
  });
});
