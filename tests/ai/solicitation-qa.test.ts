/**
 * BL-FB-SOL-QA — contracting-officer Q&A, pure parts.
 */
import { describe, expect, it } from "vitest";
import {
  describeQa,
  extractRefs,
  looksLikeQaDocument,
  matchQaToRequirements,
  normalizeRef,
  parseQaPairs,
  qaDedupeKey,
} from "@/lib/solicitation-qa-logic";

const QA_DOC = `Solicitation 47QT-26-R-0001 — Questions and Answers, Amendment 0002

Q1: Does Section L.5.2.1 require resumes for all key personnel, or only the program manager?
A1: Resumes are required for the program manager and the technical lead only. Section L.5.2.1 is amended accordingly.

Question 2: Will the Government accept monthly status reports by email?
Government Response: Yes. Monthly status reports to the COR may be delivered by email in PDF.

3. Is there an incumbent?
Answer: Yes, see the award notice.

Q4: Will the due date slip?
`;

describe("solicitation Q&A logic", () => {
  it("parses the common federal formats and drops unanswered questions", () => {
    const pairs = parseQaPairs(QA_DOC);
    expect(pairs.map((p) => p.ordinal)).toEqual([1, 2, 3]);
    expect(pairs[0]!.question).toContain("Section L.5.2.1 require resumes");
    expect(pairs[0]!.answer).toBe("Resumes are required for the program manager and the technical lead only. Section L.5.2.1 is amended accordingly.");
    expect(pairs[1]!.answer).toContain("may be delivered by email");
    expect(pairs[2]).toEqual({ ordinal: 3, question: "Is there an incumbent?", answer: "Yes, see the award notice." });

    const inline = parseQaPairs("Q: Can we team? A: Yes, with a signed teaming agreement.\nQ: Page limit? A: 30 pages.");
    expect(inline).toHaveLength(2);
    expect(inline[0]).toMatchObject({ question: "Can we team?", answer: "Yes, with a signed teaming agreement." });

    // Multi-line answers stay together; a repeated pair is stored once.
    const multi = parseQaPairs("Q1. Where?\nA1. Building 3,\nsecond floor.\n\nQ2. Where?\nA2. Building 3, second floor.");
    expect(multi).toEqual([{ ordinal: 1, question: "Where?", answer: "Building 3, second floor." }]);
    expect(parseQaPairs("The offeror shall provide 3.5 FTE per site.")).toEqual([]);
  });

  it("recognises a Q&A document by name or by content", () => {
    expect(looksLikeQaDocument("Amendment 0002 - Q&A Responses.pdf", "")).toBe(true);
    expect(looksLikeQaDocument("Industry Questions.docx", "")).toBe(true);
    expect(looksLikeQaDocument("PWS.pdf", QA_DOC)).toBe(true);
    expect(looksLikeQaDocument("PWS.pdf", "The contractor shall provide services.")).toBe(false);
  });

  it("keys pairs on their normalised text", () => {
    expect(qaDedupeKey("Where?", "Building 3")).toBe(qaDedupeKey("  where ", "building   3."));
    expect(qaDedupeKey("Where?", "Building 3")).not.toBe(qaDedupeKey("Where?", "Building 4"));
    expect(qaDedupeKey("a", "b")).toHaveLength(16);
  });

  it("extracts section references and leaves decimals alone", () => {
    expect(extractRefs("See Section L.5.2.1 and paragraph 3.2 of the PWS; also M-1 and Attachment J-1.")).toEqual(
      expect.arrayContaining(["L.5.2.1", "3.2", "M-1", "ATTACHMENT J-1"]),
    );
    expect(extractRefs("We propose 3.5 FTE at $1.25M for 10.1 months.")).toEqual([]);
    expect(normalizeRef("Section L.5.2.1.")).toBe("L.5.2.1");
    expect(normalizeRef("§ m-1")).toBe("M-1");
  });

  it("matches answers to requirements by reference, then by overlap", () => {
    const requirements = [
      { ref: "L.5.2.1", text: "The offeror shall provide resumes for all key personnel." },
      { ref: "PWS 3.2", text: "The contractor shall provide monthly status reports to the COR." },
      { ref: "M-1", text: "Proposals will be evaluated on technical approach and past performance." },
    ];
    const pairs = parseQaPairs(QA_DOC);
    const matches = matchQaToRequirements(pairs, requirements);
    expect(matches.get(1)?.[0]).toMatchObject({ ref: "L.5.2.1", byRef: true, score: 1 });
    expect(matches.get(2)?.[0]).toMatchObject({ ref: "PWS 3.2", byRef: false });
    expect(matches.get(2)![0]!.score).toBeGreaterThanOrEqual(0.5);
    expect(matches.has(3)).toBe(false);
    expect(describeQa(0, 0)).toBe("no answers yet");
    expect(describeQa(3, 2)).toBe("3 answers · 2 requirements refined");
    expect(describeQa(1, 0)).toBe("1 answer");
  });
});
