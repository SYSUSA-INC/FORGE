/**
 * BL-AIP-2 — pending tracked changes resolve to their final view in the
 * plain projection (AI input, saved text, word counts) and in exports.
 */

import { describe, expect, it } from "vitest";
import type { TipTapDoc } from "@/db/schema";
import {
  countWords,
  hasPendingTrackedChanges,
  projectToPlain,
  resolveTrackedChanges,
} from "@/lib/tiptap-doc";
import { renderDocToHtml } from "@/lib/tiptap-html";

const tc = (type: "tcInsert" | "tcDelete") => ({
  type,
  attrs: { "data-tc-id": "c1", "data-tc-author-id": "u1" },
});

const doc: TipTapDoc = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "We deliver " },
        { type: "text", text: "world-class ", marks: [tc("tcDelete")] },
        { type: "text", text: "measurable ", marks: [tc("tcInsert")] },
        { type: "text", text: "outcomes", marks: [{ type: "bold" }, tc("tcInsert")] },
        { type: "text", text: "." },
      ],
    },
    {
      // A paragraph that is entirely a pending deletion disappears.
      type: "paragraph",
      content: [{ type: "text", text: "As previously mentioned above.", marks: [tc("tcDelete")] }],
    },
    { type: "paragraph", content: [{ type: "text", text: "Second paragraph." }] },
  ],
};

describe("tracked changes — final view", () => {
  it("detects pending changes and leaves clean documents untouched", () => {
    expect(hasPendingTrackedChanges(doc)).toBe(true);
    const clean: TipTapDoc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Clean." }] }],
    };
    expect(hasPendingTrackedChanges(clean)).toBe(false);
    expect(resolveTrackedChanges(clean)).toBe(clean);
    expect(hasPendingTrackedChanges(null)).toBe(false);
  });

  it("keeps insertions (mark removed, other marks kept), drops deletions and emptied blocks", () => {
    const resolved = resolveTrackedChanges(doc);
    expect(resolved.content).toHaveLength(2);
    const first = resolved.content[0]!;
    // BL-AIP-6 — neighbouring runs with identical marks are joined, as
    // ProseMirror would on load, so the resolved shape matches a clean doc.
    expect(first.content!.map((n) => n.text)).toEqual(["We deliver measurable ", "outcomes", "."]);
    expect(first.content![0]!.marks).toBeUndefined();
    expect(first.content![1]!.marks).toEqual([{ type: "bold" }]);
    expect(hasPendingTrackedChanges(resolved)).toBe(false);
    // The input is not mutated.
    expect(doc.content).toHaveLength(3);
  });

  it("plain projection, word count and HTML export all show the final view", () => {
    expect(projectToPlain(doc)).toBe("We deliver measurable outcomes.\n\nSecond paragraph.");
    expect(countWords(doc)).toBe(6);
    const html = renderDocToHtml(doc);
    expect(html).toContain("<p>We deliver measurable <strong>outcomes</strong>.</p>");
    expect(html).not.toContain("world-class");
    expect(html).not.toContain("previously mentioned");
  });
});
