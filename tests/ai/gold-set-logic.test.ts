/**
 * BL-AIX Phase 1e — the extraction gold set's rules: annotation
 * cleaning, review progress, when a document can be approved, joining
 * attachments and searching the text.
 */
import { describe, expect, it } from "vitest";
import {
  canApproveGoldDoc,
  cleanGoldItem,
  findInText,
  goldProgress,
  goldWindows,
  joinGoldFiles,
  mergeDraftedItems,
  nextGoldWindow,
  GOLD_MAX_TEXT_CHARS,
  GOLD_WINDOW_CHARS,
} from "@/lib/gold-set-logic";

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

describe("BL-AIX Phase 1e-2 — drafting windows and merging", () => {
  const para = (i: number) => `Paragraph ${i}. The contractor shall do task ${i}.\n\n`;

  it("covers the whole text in overlapping windows ending on breaks, with no ceiling", () => {
    const text = Array.from({ length: 30_000 }, (_, i) => para(i)).join("");
    const w = goldWindows(text);
    expect(w.length).toBeGreaterThan(12);
    expect(w[0]!.start).toBe(0);
    expect(w[w.length - 1]!.end).toBe(text.length);
    for (let i = 1; i < w.length; i++) {
      expect(w[i]!.start).toBeLessThan(w[i - 1]!.end);
      expect(w[i - 1]!.end - w[i - 1]!.start).toBeLessThanOrEqual(GOLD_WINDOW_CHARS);
      expect(text[w[i - 1]!.end - 1]).toMatch(/\n|\./);
    }
    expect(goldWindows("short")).toEqual([{ index: 0, start: 0, end: 5 }]);
    expect(goldWindows("")).toEqual([]);
  });

  it("picks the next window by characters done, so appended text is drafted too", () => {
    const text = Array.from({ length: 3_000 }, (_, i) => para(i)).join("");
    const all = goldWindows(text);
    expect(nextGoldWindow(text, 0)?.window).toEqual(all[0]);
    expect(nextGoldWindow(text, all[0]!.end)?.window).toEqual(all[1]);
    expect(nextGoldWindow(text, text.length)).toBeNull();
    const grown = `${text}\n\n===== Q&A =====\nOfferors shall submit resumes.`;
    expect(nextGoldWindow(grown, text.length)?.window.end).toBe(grown.length);
  });

  it("drops duplicates of existing annotations (rejected ones too) and within the batch, and numbers factors after existing ones", () => {
    const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    const { items, duplicates } = mergeDraftedItems(
      {
        requirements: [
          { ref: "C.1", text: "The contractor shall migrate 40 applications." },
          { ref: "C.2", text: "The contractor shall provide 24x7 support." },
          { ref: "", text: "THE CONTRACTOR SHALL PROVIDE 24X7 SUPPORT." },
          { ref: "", text: "  " },
        ],
        pageLimits: [{ ref: "L.5", text: "Volume I shall not exceed 25 pages.", value: "25 pages" }],
        evalFactors: [
          { ref: "M.2", name: "Past performance", importance: "less important", order: 2 },
          { ref: "M.1", name: "Management approach", importance: "most important", order: 1 },
        ],
      },
      [
        { kind: "requirement", text: "The contractor shall migrate 40 applications.", position: 0 },
        { kind: "eval_factor", text: "Technical approach", position: 1 },
      ],
      same,
    );
    expect(duplicates).toBe(2);
    expect(items.map((i) => [i.kind, i.text, i.position])).toEqual([
      ["requirement", "The contractor shall provide 24x7 support.", 0],
      ["page_limit", "Volume I shall not exceed 25 pages.", 0],
      ["eval_factor", "Management approach", 2],
      ["eval_factor", "Past performance", 3],
    ]);
    expect(items.find((i) => i.kind === "page_limit")?.value).toBe("25 pages");
  });
});
