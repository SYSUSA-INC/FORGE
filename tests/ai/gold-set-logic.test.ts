/**
 * BL-AIX Phase 1e — the extraction gold set's rules: annotation
 * cleaning, review progress, when a document can be approved, joining
 * attachments and searching the text.
 */
import { describe, expect, it } from "vitest";
import { canApproveGoldDoc, cleanGoldItem, findInText, goldProgress, joinGoldFiles, GOLD_MAX_TEXT_CHARS } from "@/lib/gold-set-logic";

describe("BL-AIX Phase 1e — gold set rules", () => {
  it("cleans an annotation and refuses unusable ones", () => {
    expect(cleanGoldItem({ kind: "requirement", ref: " C.1 ", text: "  The contractor   shall migrate 40 apps. ", value: "x", position: 3 })).toEqual({
      ok: true,
      item: { kind: "requirement", ref: "C.1", text: "The contractor shall migrate 40 apps.", value: "x", position: 0 },
    });
    expect(cleanGoldItem({ kind: "eval_factor", text: "Technical approach", position: "2" })).toMatchObject({ ok: true, item: { position: 2 } });
    expect(cleanGoldItem({ kind: "nonsense", text: "abc" })).toEqual({ ok: false, error: "Unknown annotation kind." });
    expect(cleanGoldItem({ kind: "page_limit", text: " a " })).toMatchObject({ ok: false });
  });

  it("counts progress per status and per kind, leaving rejected rows out of the kind counts", () => {
    const p = goldProgress([
      { kind: "requirement", status: "approved" },
      { kind: "requirement", status: "proposed" },
      { kind: "page_limit", status: "rejected" },
      { kind: "eval_factor", status: "approved" },
    ]);
    expect(p).toMatchObject({ total: 4, proposed: 1, approved: 2, rejected: 1 });
    expect(p.byKind).toEqual({
      requirement: { approved: 1, proposed: 1 },
      page_limit: { approved: 0, proposed: 0 },
      eval_factor: { approved: 1, proposed: 0 },
    });
  });

  it("approves a document only when everything is decided and a requirement is kept", () => {
    expect(canApproveGoldDoc(goldProgress([{ kind: "requirement", status: "proposed" }]))).toEqual({
      ok: false,
      reason: "1 annotation is still waiting for review.",
    });
    expect(canApproveGoldDoc(goldProgress([{ kind: "page_limit", status: "approved" }]))).toEqual({
      ok: false,
      reason: "Approve at least one requirement first.",
    });
    expect(canApproveGoldDoc(goldProgress([{ kind: "requirement", status: "approved" }, { kind: "eval_factor", status: "rejected" }]))).toEqual({ ok: true });
  });

  it("joins attachments under file headers, skips empty ones and bounds the total", () => {
    expect(joinGoldFiles([{ name: "RFP.pdf", text: " Section L " }, { name: "scan.pdf", text: "  " }, { name: "PWS.docx", text: "C.1" }])).toEqual({
      text: "===== RFP.pdf =====\nSection L\n\n===== PWS.docx =====\nC.1",
      truncated: false,
    });
    const big = joinGoldFiles([{ name: "a", text: "x".repeat(GOLD_MAX_TEXT_CHARS + 10) }]);
    expect(big.truncated).toBe(true);
    expect(big.text).toHaveLength(GOLD_MAX_TEXT_CHARS);
  });

  it("finds a phrase in the text with context, case-insensitively", () => {
    const text = "Volume I shall not exceed 25 pages.\nVolume II SHALL NOT EXCEED 10 pages.";
    const hits = findInText(text, "shall not exceed", 10, 8);
    expect(hits.map((h) => h.at)).toEqual([9, 46]);
    expect(hits[0]!.snippet).toBe("…olume I shall not exceed 25 page…");
    expect(findInText(text, "ab")).toEqual([]);
  });
});
