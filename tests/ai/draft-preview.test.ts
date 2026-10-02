/**
 * BL-FB-CHAT-SIDEBYSIDE — a chat reply previewed as edits to the draft.
 * Invariants: taking every change gives the reply, taking none gives
 * the draft; the alignment matches the tracked apply's.
 */
import { describe, expect, it } from "vitest";
import {
  changedIndexes,
  composeSelection,
  looksLikeRewrite,
  previewOps,
  summarizePreview,
} from "@/lib/draft-preview";

const DRAFT =
  "Our team runs the SOC around the clock.\n\nWe staff ten analysts on three shifts.\n\nReports go to the program office monthly.";
const REWRITE =
  "Our team runs the SOC around the clock.\n\nWe staff twelve analysts on three shifts, with a named lead per shift.\n\nTransition completes in 30 days.";
const ANSWER = "The page cap is three pages; you have room for one more paragraph.";

describe("draft preview", () => {
  it("aligns a rewrite to the draft: kept, edited, removed, new", () => {
    const ops = previewOps(DRAFT, REWRITE);
    expect(ops.map((o) => o.kind)).toEqual(["equal", "replace", "delete", "insert"]);
    expect(ops.map((o) => o.index)).toEqual([0, 1, 2, 3]);
    const edited = ops[1]!;
    if (edited.kind !== "replace") throw new Error("expected replace");
    expect(edited.words.some((w) => w.kind === "removed" && w.text.includes("ten"))).toBe(true);
    expect(edited.words.some((w) => w.kind === "added" && w.text.includes("twelve"))).toBe(true);
    expect(summarizePreview(ops)).toEqual({
      kept: 1,
      inserted: 1,
      deleted: 1,
      replaced: 1,
      changed: 3,
      label: "3 paragraphs change · 1 kept",
    });
    expect(changedIndexes(ops)).toEqual([1, 2, 3]);
    expect(previewOps("", "")).toEqual([]);
    expect(summarizePreview(previewOps(DRAFT, DRAFT)).label).toBe("no changes to the draft");
  });

  it("composes the selection: all → the reply, none → the draft, some → a mix", () => {
    const ops = previewOps(DRAFT, REWRITE);
    expect(composeSelection(ops, new Set(changedIndexes(ops)))).toBe(REWRITE);
    expect(composeSelection(ops, new Set())).toBe(DRAFT);
    expect(composeSelection(ops, new Set([1]))).toBe(
      "Our team runs the SOC around the clock.\n\nWe staff twelve analysts on three shifts, with a named lead per shift.\n\nReports go to the program office monthly.",
    );
    // Taking the removal but not the new paragraph drops the old one and adds nothing.
    expect(composeSelection(ops, new Set([2]))).toBe(
      "Our team runs the SOC around the clock.\n\nWe staff ten analysts on three shifts.",
    );
  });

  it("tells a rewrite from an answer about the draft", () => {
    expect(looksLikeRewrite(previewOps(DRAFT, REWRITE), false)).toBe(true);
    expect(looksLikeRewrite(previewOps(DRAFT, ANSWER), false)).toBe(false);
    expect(looksLikeRewrite(previewOps(DRAFT, DRAFT), false)).toBe(false);
    expect(looksLikeRewrite(previewOps("", ANSWER), true)).toBe(false);
    expect(looksLikeRewrite(previewOps("", `${REWRITE}\n\n${REWRITE}`), true)).toBe(true);
  });
});
