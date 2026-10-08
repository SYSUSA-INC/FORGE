/**
 * BL-STAB-9 — the AI document review builds on the parse, and a cut-off
 * structured answer says it was cut off. Pure.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { applyStopReason } from "@/lib/ai";
import type { ReviewedRequirement } from "@/lib/requirement-review";
import { buildReviewBasis, capabilityAreaOf, requirementIdOf, reviewFreshness, unscoredRequirementIds } from "@/lib/review-basis";
import type { LmStructure } from "@/lib/solicitation-lm";
import { solicitationReviewSchema, questionSetSchema, capabilityMatrixSchema } from "@/lib/ai-prompts-bl23";
import { describeZodIssues } from "@/lib/zod-issues";
import { tolerantList } from "@/lib/zod-tolerant";

const req = (text: string, extra: Partial<ReviewedRequirement> = {}): ReviewedRequirement => ({ kind: "shall", text, ref: "C.1", ...extra });

const LM: LmStructure = {
  sectionL: {
    volumes: [{ name: "Volume I - Technical", pageLimit: 25, pageLimitText: "25 pages", contents: "Technical approach", quote: "Volume I shall not exceed 25 pages." }],
    formatRules: [{ rule: "12-point Times New Roman", quote: "12-point Times New Roman" }],
    submission: [{ rule: "Due 1 November 2026, 2 p.m. Eastern", quote: "due 1 November 2026" }],
  },
  sectionM: {
    basis: "tradeoff",
    basisQuote: "best value",
    relativeImportance: "Technical approach is more important than price.",
    factors: [
      { name: "Technical approach", importance: "most important", subfactors: [{ name: "Transition", importance: "" }], quote: "Factor 1" },
      { name: "Price", importance: "", subfactors: [], quote: "Factor 2" },
    ],
  },
};

describe("BL-STAB-9 — the review's basis comes from the parse", () => {
  it("lists the verified requirements (rejected left out) with ids that survive a reorder and an edit", () => {
    const a = req("The contractor shall staff the help desk.");
    const b = req("The contractor shall report monthly.", { kind: "should", ref: "C.2" });
    const rejected = req("Offerors may visit the site.", { review: { status: "rejected" } });
    const edited = req("The contractor shall report weekly.", { review: { status: "edited", original: { kind: "shall", text: "The contractor shall report monthly.", ref: "C.2" } } });

    const first = buildReviewBasis({ requirements: [a, b, rejected], lm: LM, sectionLSummary: "", sectionMSummary: "" });
    expect(first.requirements.map((r) => r.text)).toEqual([a.text, b.text]);
    expect(first.requirements[0]!.id).toMatch(/^req_[0-9a-f]{12}$/);

    const reordered = buildReviewBasis({ requirements: [b, a], lm: LM, sectionLSummary: "", sectionMSummary: "" });
    expect(reordered.requirements.find((r) => r.text === a.text)!.id).toBe(first.requirements[0]!.id);

    // An edit keeps the id of the wording intake produced, so the matrix cell still applies.
    const afterEdit = buildReviewBasis({ requirements: [a, edited], lm: LM, sectionLSummary: "", sectionMSummary: "" });
    expect(afterEdit.requirements[1]!.id).toBe(first.requirements[1]!.id);
    expect(afterEdit.requirements[1]!.text).toBe("The contractor shall report weekly.");
    // …but the basis changed, so a stored review is stale.
    expect(afterEdit.hash).not.toBe(first.hash);
    expect(reordered.hash).not.toBe(first.hash);
  });

  it("gives a repeated clause its own id", () => {
    const basis = buildReviewBasis({ requirements: [req("Same clause."), req("Same clause.", { sourceDocId: "d1" })], lm: {}, sectionLSummary: "", sectionMSummary: "" });
    expect(new Set(basis.requirements.map((r) => r.id)).size).toBe(2);
    expect(basis.requirements[1]!.id).toBe(`${basis.requirements[0]!.id}_2`);
    expect(requirementIdOf(req("Same clause."))).toBe(basis.requirements[0]!.id);
  });

  it("reads Sections L and M and the factors from the structured sections, else from the summaries", () => {
    const basis = buildReviewBasis({ requirements: [], lm: LM, sectionLSummary: "ignored", sectionMSummary: "ignored" });
    expect(basis.sectionL).toEqual(["Volume I - Technical: 25 pages — Technical approach", "12-point Times New Roman", "Due 1 November 2026, 2 p.m. Eastern"]);
    expect(basis.sectionM[0]).toBe("Basis for award: best-value tradeoff.");
    expect(basis.sectionM).toContain("Technical approach — most important");
    expect(basis.evaluationFactors).toEqual([
      { name: "Technical approach", weight: "most important", notes: "Subfactors: Transition" },
      { name: "Price", weight: "", notes: "" },
    ]);

    const fromSummaries = buildReviewBasis({
      requirements: [],
      lm: {},
      sectionLSummary: "Volume I is limited to 25 pages. Use 12-point font.",
      sectionMSummary: "Technical is most important.\nPrice is least important.",
    });
    expect(fromSummaries.sectionL).toEqual(["Volume I is limited to 25 pages.", "Use 12-point font."]);
    expect(fromSummaries.sectionM).toEqual(["Technical is most important.", "Price is least important."]);
    expect(fromSummaries.evaluationFactors).toEqual([]);
  });

  it("groups requirements by the part of the document that states them", () => {
    expect(capabilityAreaOf(req("x", { source: { quote: "exact", section: "C" } }))).toBe("Section C");
    expect(capabilityAreaOf(req("x", { source: { quote: "exact", section: "L" } }))).toBe("Section L (instructions)");
    expect(capabilityAreaOf(req("x", { source: { quote: "exact", section: "Attachment J-1" } }))).toBe("Attachment J-1");
    expect(capabilityAreaOf(req("x"))).toBe("");
  });

  it("tells a current review from a stale or a legacy one, and finds what the matrix has not scored", () => {
    expect(reviewFreshness({ basis: { source: "parse", hash: "h1", requirementCount: 3 } }, "h1")).toBe("current");
    expect(reviewFreshness({ basis: { source: "parse", hash: "h1", requirementCount: 3 } }, "h2")).toBe("stale");
    expect(reviewFreshness({}, "h1")).toBe("legacy");
    expect(unscoredRequirementIds([{ id: "a" }, { id: "b" }, { id: "c" }], [{ requirementId: "b" }, { requirementId: "zz" }])).toEqual(["a", "c"]);
  });
});

describe("BL-STAB-9 — the answers are sized and read entry by entry", () => {
  it("asks the review model for judgement only", () => {
    const shape = Object.keys(solicitationReviewSchema.shape).sort();
    expect(shape).toEqual(["flaggedQuestions", "mandatoryCertifications", "periodOfPerformance", "placeOfPerformance", "setAside", "summary"]);
    // A missing field or a bad entry no longer fails the review.
    expect(solicitationReviewSchema.parse({ summary: "S", flaggedQuestions: ["ok", 7, "also ok"] })).toEqual({
      summary: "S",
      periodOfPerformance: "",
      placeOfPerformance: "",
      setAside: "",
      mandatoryCertifications: [],
      flaggedQuestions: ["ok", "also ok"],
    });
  });

  it("drops a malformed matrix cell or question instead of the answer", () => {
    const cells = capabilityMatrixSchema.parse({ cells: [{ requirementId: "r1", status: "Strong" }, { status: "gap" }, null] });
    expect(cells.cells).toEqual([{ requirementId: "r1", capabilityRef: "", status: "Strong", citation: "", narrative: "" }]);
    const qs = questionSetSchema.parse({ questions: [{ text: "Is the page limit inclusive?" }, { text: "" }, "junk"] });
    expect(qs.questions).toHaveLength(1);
    expect(qs.questions[0]).toMatchObject({ id: "", category: "scope_ambiguity", text: "Is the page limit inclusive?" });
  });

  it("caps a tolerant list", () => {
    expect(tolerantList(z.string(), 2).parse(["a", "b", "c"])).toEqual(["a", "b"]);
    expect(tolerantList(z.string(), 2).parse(undefined)).toEqual([]);
  });
});

describe("BL-STAB-9 — a cut-off answer says it was cut off", () => {
  const ok = { data: { a: 1 }, parseError: null, viaTool: true };
  const bad = { data: null, parseError: "AI response didn't match the expected shape (x: expected array, received undefined).", viaTool: true };

  it("fails a cut-off answer even when what arrived validates", () => {
    const v = applyStopReason(ok, "max_tokens", { maxTokens: 4000 });
    expect(v.data).toBeNull();
    expect(v.truncated).toBe(true);
    expect(v.parseError).toBe("The AI's answer was cut off at its 4,000-token output limit before it finished.");
    expect(applyStopReason(bad, "length", {}).parseError).toBe("The AI's answer was cut off at its output limit before it finished.");
  });

  it("keeps a validated partial answer for a caller that handles one, and leaves finished answers alone", () => {
    expect(applyStopReason(ok, "max_tokens", { acceptTruncated: true })).toEqual({ ...ok, truncated: true });
    expect(applyStopReason(bad, "max_tokens", { acceptTruncated: true, maxTokens: 2400 }).parseError).toMatch(/^The AI's answer was cut off at its 2,400-token output limit before it finished\. AI response didn't match/);
    expect(applyStopReason(ok, "tool_use", { maxTokens: 4000 })).toBe(ok);
    expect(applyStopReason(bad, "end_turn", {})).toBe(bad);
  });

  it("says how many more issues there were, so the shown ones are not read as the only ones", () => {
    const schema = z.object({ a: z.string(), b: z.array(z.string()), c: z.array(z.string()), d: z.string(), e: z.string(), f: z.array(z.string()) });
    const parsed = schema.safeParse({ a: "x" });
    expect(parsed.success).toBe(false);
    const text = describeZodIssues(parsed.error!, { a: "x" });
    expect(text).toMatch(/^b: .*; c: .*; d: .*; and 2 more \(e, f\)$/);
  });
});
