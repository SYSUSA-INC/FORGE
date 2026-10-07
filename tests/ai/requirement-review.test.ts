/**
 * BL-AIX Phase 2c — applying the team's verdicts to extracted
 * requirements: idempotent, reversible, scoped to the document a clause
 * came from, and invisible to readers once rejected.
 */
import { describe, expect, it } from "vitest";
import {
  activeRequirements,
  applyCorrections,
  applyOpportunityVerdicts,
  mergeWithCorrections,
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

describe("BL-AIX Phase 2c-1 review fixes — merging documents with verdicts", () => {
  const X = "Volume I shall not exceed 25 pages.";
  const Y = "Volume I shall not exceed 30 pages.";
  const edit = fix({ originalKey: requirementKey(X), action: "edited", corrected: { kind: "shall", text: Y, ref: "L.5" } });

  it("dedupes on the extracted wording, so an edit does not let a companion's copy of the old clause back in", () => {
    const own = applyCorrections([{ kind: "shall", text: X, ref: "L.5" }] as ReviewedRequirement[], [edit]);
    const merged = mergeWithCorrections({ own, docs: [{ id: "pws", requirements: [{ kind: "shall", text: X, ref: "" }] }], corrections: [edit] });
    expect(merged.map((r) => [r.text, r.sourceDocId ?? ""])).toEqual([[Y, ""]]);
  });

  it("removing an added clause leaves a companion document's copy of it", () => {
    const A = "Offerors may include a cover letter of one page.";
    const added = fix({ originalKey: requirementKey(A), action: "added", corrected: { kind: "may", text: A, ref: "" } });
    const docs = [{ id: "pws", requirements: [{ kind: "may" as const, text: A, ref: "" }] }];
    const withAdd = mergeWithCorrections({ own: [], docs, corrections: [added] });
    expect(withAdd.map((r) => [r.text, r.review?.status])).toEqual([[A, "added"]]);
    const removed = mergeWithCorrections({ own: withAdd, docs, corrections: [] });
    expect(removed.map((r) => [r.text, r.sourceDocId, r.review?.status])).toEqual([[A, "pws", undefined]]);
  });

  it("an addition that extraction later finds keeps the extracted clause, confirmed, and undoing it keeps the clause", () => {
    const A = "The contractor shall staff the help desk with three analysts.";
    const extracted = [{ kind: "shall", text: A, ref: "C.4", source: { quote: "exact" as const, at: 5 } }] as ReviewedRequirement[];
    const added = fix({ originalKey: requirementKey(A), action: "added", corrected: { kind: "shall", text: A, ref: "" } });
    const merged = mergeWithCorrections({ own: extracted, docs: [], corrections: [added] });
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ ref: "C.4", source: { quote: "exact" }, review: { status: "confirmed" } });
    expect(mergeWithCorrections({ own: merged, docs: [], corrections: [] })).toEqual(extracted);
  });

  it("applies each document's verdicts to its own clauses and adds an addition once", () => {
    const P = "The contractor shall submit a monthly report.";
    const A = "Offerors may submit questions by email.";
    const corrections = [
      fix({ docKey: "doc-2", originalKey: requirementKey(P), action: "rejected" }),
      fix({ originalKey: requirementKey(A), action: "added", corrected: { kind: "may", text: A, ref: "" } }),
    ];
    const merged = mergeWithCorrections({
      own: [],
      docs: [
        { id: "doc-1", requirements: [{ kind: "shall", text: "The contractor shall keep a risk register.", ref: "" }] },
        { id: "doc-2", requirements: [{ kind: "shall", text: P, ref: "" }] },
      ],
      corrections,
    });
    expect(merged.map((r) => [r.text, r.sourceDocId ?? "", r.review?.status ?? null])).toEqual([
      [A, "", "added"],
      ["The contractor shall keep a risk register.", "doc-1", null],
      [P, "doc-2", "rejected"],
    ]);
  });
});

describe("BL-AIX Phase 2c-1 review fixes — verdicts across an opportunity", () => {
  it("treats an amendment's unreviewed copy of a rejected or edited clause the same way", () => {
    const rejected = applyCorrections([invented], [fix({ originalKey: requirementKey(invented.text), action: "rejected" })]);
    const edited = applyCorrections([pages], [fix({ originalKey: requirementKey(pages.text), action: "edited", corrected: { kind: "shall", text: "Volume I shall not exceed 30 pages.", ref: "L.5" } })]);
    const amendment: ReviewedRequirement[] = [
      { kind: "should", text: invented.text, ref: "" },
      { kind: "shall", text: pages.text, ref: "L.5" },
      { kind: "shall", text: "A brand new clause in the amendment.", ref: "" },
    ];
    const [after] = applyOpportunityVerdicts([amendment, [...rejected, ...edited]]);
    expect(after!.map((r) => [r.text, r.review?.status ?? null])).toEqual([
      [invented.text, "rejected"],
      ["Volume I shall not exceed 30 pages.", "edited"],
      ["A brand new clause in the amendment.", null],
    ]);
    expect(activeRequirements(after!)).toHaveLength(2);
    expect(applyOpportunityVerdicts([amendment])).toEqual([amendment]);
  });
});
