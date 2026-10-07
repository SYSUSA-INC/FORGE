/**
 * BL-AIX Phase 2c — applying the team's verdicts to extracted
 * requirements: idempotent, reversible, scoped to the document a clause
 * came from, and invisible to readers once rejected.
 */
import { describe, expect, it } from "vitest";
import {
  activeRequirements,
  applyCorrections,
  cleanClause,
  reviewCounts,
  reviewKeyOf,
  sourceSnippet,
  verifyOrder,
  type Correction,
  type ReviewedRequirement,
} from "@/lib/requirement-review";
import { requirementKey } from "@/lib/requirements-text";

const at = new Date("2026-10-07T12:00:00Z");
const fix = (c: Partial<Correction> & Pick<Correction, "originalKey" | "action">): Correction => ({
  docKey: "",
  corrected: {},
  original: {},
  userId: "u1",
  updatedAt: at,
  ...c,
});

const transition: ReviewedRequirement = { kind: "shall", text: "The contractor shall complete transition within 30 days.", ref: "C.3", source: { quote: "exact", at: 10 } };
const pages: ReviewedRequirement = { kind: "shall", text: "Volume I shall not exceed 25 pages.", ref: "L.5", source: { quote: "partial", at: 90 } };
const invented: ReviewedRequirement = { kind: "should", text: "The contractor should delight every user.", ref: "", source: { quote: "none" } };
const pws: ReviewedRequirement = { kind: "shall", text: "The contractor shall submit a monthly report.", ref: "PWS 2.1", sourceDocId: "doc-1" };
const list = [transition, pages, invented, pws];

describe("BL-AIX Phase 2c — applying verdicts", () => {
  const corrections = [
    fix({ originalKey: requirementKey(transition.text), action: "confirmed" }),
    fix({ originalKey: requirementKey(pages.text), action: "edited", corrected: { kind: "shall", text: "Volume I shall not exceed 30 pages.", ref: "L.5.1" } }),
    fix({ originalKey: requirementKey(invented.text), action: "rejected" }),
    fix({ originalKey: "", action: "added", corrected: { kind: "may", text: "Offerors may submit a cover letter.", ref: "L.2" } }),
  ];
  const applied = applyCorrections(list, corrections);

  it("confirms, edits keeping the original, rejects, and appends an added clause", () => {
    expect(applied.map((r) => [r.text, r.review?.status ?? null])).toEqual([
      [transition.text, "confirmed"],
      ["Volume I shall not exceed 30 pages.", "edited"],
      [invented.text, "rejected"],
      [pws.text, null],
      ["Offerors may submit a cover letter.", "added"],
    ]);
    expect(applied[1]!.review!.original).toEqual({ kind: "shall", text: pages.text, ref: "L.5" });
    expect(applied[1]!.ref).toBe("L.5.1");
    expect(applied[1]!.source).toEqual(pages.source);
    expect(applied[0]!.review).toMatchObject({ by: "u1", at: at.toISOString() });
  });

  it("is idempotent: the edited clause is matched by its original wording again", () => {
    expect(applyCorrections(applied, corrections)).toEqual(applied);
    expect(reviewKeyOf(applied[1]!)).toBe(requirementKey(pages.text));
  });

  it("undoes: without its correction a clause returns to its extracted wording, and an added one goes", () => {
    const undone = applyCorrections(applied, []);
    expect(undone).toEqual(list);
  });

  it("scopes a verdict to the document the clause came from", () => {
    const wrongDoc = applyCorrections(list, [fix({ originalKey: requirementKey(pws.text), action: "rejected" })]);
    expect(wrongDoc[3]!.review).toBeUndefined();
    const rightDoc = applyCorrections(list, [fix({ docKey: "doc-1", originalKey: requirementKey(pws.text), action: "rejected" })]);
    expect(rightDoc[3]!.review?.status).toBe("rejected");
  });

  it("keeps rejected clauses from readers and counts what is left to do", () => {
    expect(activeRequirements(applied).map((r) => r.text)).not.toContain(invented.text);
    expect(activeRequirements(applied)).toHaveLength(4);
    expect(reviewCounts(applied)).toEqual({ confirmed: 1, edited: 1, rejected: 1, added: 1, unreviewed: 1, notFound: 0 });
    expect(reviewCounts(list)).toMatchObject({ unreviewed: 4, notFound: 1 });
  });

  it("puts what most needs a person first", () => {
    expect(verifyOrder(list).map((r) => r.text)).toEqual([invented.text, pages.text, transition.text, pws.text]);
    expect(verifyOrder(applied).at(-1)!.review).toBeDefined();
  });
});

describe("BL-AIX Phase 2c — typed clauses and source snippets", () => {
  it("cleans a clause a person typed", () => {
    expect(cleanClause({ kind: "must", text: "  The offeror   shall sign. ", ref: " L.9 " })).toEqual({ kind: "shall", text: "The offeror shall sign.", ref: "L.9" });
    expect(cleanClause({ kind: "may", text: "   " })).toBeNull();
  });

  it("shows the document text around a located clause, on word boundaries", () => {
    const raw = "Intro words here. The contractor shall complete transition within 30 days. Then more text follows after it.";
    const atIdx = raw.indexOf("The contractor");
    const snip = sourceSnippet(raw, atIdx, 54, 10);
    expect(snip).toContain("The contractor shall complete transition within 30 days.");
    expect(snip.startsWith("… ")).toBe(true);
    expect(snip.endsWith(" …")).toBe(true);
    expect(sourceSnippet(raw, undefined, 10)).toBe("");
  });
});
