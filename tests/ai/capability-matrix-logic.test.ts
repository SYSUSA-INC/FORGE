import { describe, expect, it } from "vitest";
import {
  buildQuestionSet,
  carryOverAnswers,
  parseVersionOf,
  STANDING_QUESTIONS,
  type CapabilityAnswer,
} from "@/lib/capability-matrix-types";

const drafted = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    text: `Can we deliver item ${i + 1}?`,
    refs: [`C.${i + 1}`, "X.9"],
    kind: "shall" as const,
    area: "Technical",
  }));
const known = new Set(["C.1", "C.2", "C.3", "C.4", "C.5"]);
const answer = (value: CapabilityAnswer["value"]): CapabilityAnswer => ({
  value,
  evidence: "",
  partnerCompanyId: null,
  updatedAt: "2026-10-25T00:00:00Z",
  updatedByUserId: "u1",
});

describe("buildQuestionSet", () => {
  it("puts the standing questions first, numbers drafted ones, and drops invented refs", () => {
    const qs = buildQuestionSet(drafted(3), known);
    expect(qs.slice(0, STANDING_QUESTIONS.length).every((q) => q.kind === "standing" && q.refs.length === 0)).toBe(true);
    const q1 = qs[STANDING_QUESTIONS.length]!;
    expect(q1.id).toBe("q1");
    expect(q1.refs).toEqual(["C.1"]);
  });

  it("de-duplicates by text and caps the drafted questions at 20", () => {
    const many = [...drafted(25), ...drafted(2)];
    const qs = buildQuestionSet(many, known).filter((q) => q.kind !== "standing");
    expect(qs.length).toBe(20);
    expect(new Set(qs.map((q) => q.text)).size).toBe(20);
  });

  it("drops a drafted question that repeats a standing one", () => {
    const qs = buildQuestionSet([{ text: STANDING_QUESTIONS[0]!.text, refs: [], kind: "may", area: "Position" }], known);
    expect(qs.length).toBe(STANDING_QUESTIONS.length);
  });
});

describe("carryOverAnswers", () => {
  it("keeps standing answers by id and drafted answers by text, through a renumbering", () => {
    const prev = buildQuestionSet(drafted(3), known);
    const prevAnswers = { s1: answer("have_proven"), q2: answer("partial"), q3: answer("gap_none") };
    // Rebuild drops item 1, so former q2 becomes q1 and q3 becomes q2.
    const next = buildQuestionSet(drafted(3).slice(1), known);
    const carried = carryOverAnswers(prev, prevAnswers, next);
    expect(carried.s1?.value).toBe("have_proven");
    expect(carried.q1?.value).toBe("partial");
    expect(carried.q2?.value).toBe("gap_none");
    expect(Object.keys(carried).length).toBe(3);
  });
});

describe("parseVersionOf", () => {
  it("changes when the requirement refs change and not when their order does", () => {
    const a = parseVersionOf({ primarySolicitationId: "sol", requirements: [{ kind: "shall", text: "", ref: "A" }, { kind: "may", text: "", ref: "B" }] });
    const b = parseVersionOf({ primarySolicitationId: "sol", requirements: [{ kind: "may", text: "", ref: "B" }, { kind: "shall", text: "", ref: "A" }] });
    const c = parseVersionOf({ primarySolicitationId: "sol", requirements: [{ kind: "shall", text: "", ref: "A" }] });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
