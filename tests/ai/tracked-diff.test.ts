/**
 * BL-AIP-6 — AI rewrites as tracked changes.
 *
 * Invariants: accept-all gives the proposal, reject-all gives the
 * original; untouched blocks (tables, lists, marks) survive verbatim;
 * every change is authored FORGE AI.
 */
import { describe, expect, it } from "vitest";
import type { TipTapDoc, TipTapNode } from "@/db/schema";
import {
  appendAsTrackedInsertion,
  applyAsTrackedChanges,
  FORGE_AI_AUTHOR,
  paragraphSimilarity,
  splitParagraphs,
} from "@/lib/tracked-diff";
import {
  hasPendingTrackedChanges,
  projectToPlain,
  rejectTrackedChanges,
  resolveTrackedChanges,
} from "@/lib/tiptap-doc";

const table: TipTapNode = {
  type: "table",
  content: [
    {
      type: "tableRow",
      content: [
        { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "Role" }] }] },
        { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "FTE" }] }] },
      ],
    },
  ],
};

const doc: TipTapDoc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Staffing approach" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "We staff the program with " },
        { type: "text", text: "12 cleared engineers", marks: [{ type: "bold" }] },
        { type: "text", text: " across two shifts." },
      ],
    },
    table,
    { type: "paragraph", content: [{ type: "text", text: "Surge capacity is available within 30 days." }] },
  ],
};

const ids = () => {
  let n = 0;
  return () => `c${++n}`;
};

function marksOf(node: TipTapNode): string[] {
  return (node.marks ?? []).map((m) => m.type);
}

describe("BL-AIP-6 — applyAsTrackedChanges", () => {
  const proposed = [
    "Staffing approach",
    "We staff the program with 12 cleared engineers across three shifts, with a named lead per shift.",
    "Role | FTE",
    "Transition risk is mitigated by a 30-day overlap with the incumbent.",
  ].join("\n\n");

  it("keeps untouched blocks verbatim and expresses edits as FORGE AI marks", () => {
    const res = applyAsTrackedChanges({ doc, proposedText: proposed, idFactory: ids(), now: 1 });
    const out = res.doc.content!;
    // Heading and table are unchanged objects.
    expect(out[0]).toEqual(doc.content![0]);
    expect(out[2]).toEqual(table);
    expect(res.untouchedBlocks).toBe(2);

    // The edited paragraph keeps its bold run and gets word-level marks.
    const para = out[1]!;
    const bold = para.content!.find((n) => marksOf(n).includes("bold") && !marksOf(n).includes("tcDelete"));
    expect(bold?.text).toBe("12 cleared engineers");
    const deleted = para.content!.filter((n) => marksOf(n).includes("tcDelete")).map((n) => n.text).join("");
    const inserted = para.content!.filter((n) => marksOf(n).includes("tcInsert")).map((n) => n.text).join("");
    expect(deleted).toContain("two");
    expect(inserted).toContain("three");
    expect(inserted).toContain("named lead per shift");
    const anyMark = para.content!.flatMap((n) => n.marks ?? []).find((m) => m.type === "tcInsert");
    expect(anyMark?.attrs).toMatchObject({
      "data-tc-author-id": FORGE_AI_AUTHOR.id,
      "data-tc-author-name": "FORGE AI",
      "data-tc-ts": "1",
    });

    // The last paragraph is unrelated: struck whole, replacement inserted.
    const struck = out[3]!;
    expect(struck.content!.every((n) => marksOf(n).includes("tcDelete"))).toBe(true);
    const added = out[4]!;
    expect(added.content!.every((n) => marksOf(n).includes("tcInsert"))).toBe(true);
    expect(res.changes).toBeGreaterThanOrEqual(4);
    expect(res.deletedWords).toBeGreaterThan(0);
    expect(res.insertedWords).toBeGreaterThan(0);
  });

  it("accept-all yields the proposal and reject-all yields the original", () => {
    const res = applyAsTrackedChanges({ doc, proposedText: proposed, idFactory: ids() });
    expect(hasPendingTrackedChanges(res.doc)).toBe(true);
    expect(projectToPlain(resolveTrackedChanges(res.doc))).toBe(proposed);
    expect(projectToPlain(rejectTrackedChanges(res.doc))).toBe(projectToPlain(doc));
    // Rejecting also restores the structure, not just the text.
    expect(rejectTrackedChanges(res.doc).content).toEqual(doc.content);
  });

  it("is a no-op for identical text", () => {
    const same = projectToPlain(doc);
    const res = applyAsTrackedChanges({ doc, proposedText: same, idFactory: ids() });
    expect(res.changes).toBe(0);
    expect(res.doc.content).toEqual(doc.content);
  });

  it("settles earlier pending suggestions to their original view before diffing", () => {
    const withPending: TipTapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "We deliver " },
            { type: "text", text: "quickly", marks: [{ type: "tcInsert", attrs: { "data-tc-id": "h1" } }] },
            { type: "text", text: "slowly", marks: [{ type: "tcDelete", attrs: { "data-tc-id": "h2" } }] },
            { type: "text", text: "." },
          ],
        },
      ],
    };
    const res = applyAsTrackedChanges({ doc: withPending, proposedText: "We deliver on time.", idFactory: ids() });
    expect(projectToPlain(rejectTrackedChanges(res.doc))).toBe("We deliver slowly.");
    expect(projectToPlain(resolveTrackedChanges(res.doc))).toBe("We deliver on time.");
  });

  it("handles an empty document as pure insertion", () => {
    const res = applyAsTrackedChanges({ doc: { type: "doc", content: [] }, proposedText: "First.\n\nSecond.", idFactory: ids() });
    expect(res.doc.content).toHaveLength(2);
    expect(res.changes).toBe(2);
    expect(projectToPlain(rejectTrackedChanges(res.doc))).toBe("");
  });
});

describe("BL-AIP-6 — appendAsTrackedInsertion", () => {
  it("appends inserted paragraphs and leaves the rest untouched", () => {
    const res = appendAsTrackedInsertion({ doc, text: "Past performance: FA8-123.\n\nCPARS: exceptional.", idFactory: ids() });
    expect(res.doc.content!.slice(0, 4)).toEqual(doc.content);
    expect(res.doc.content).toHaveLength(6);
    expect(res.changes).toBe(1);
    expect(projectToPlain(rejectTrackedChanges(res.doc))).toBe(projectToPlain(doc));
    expect(projectToPlain(res.doc)).toContain("CPARS: exceptional.");
  });
});

describe("BL-AIP-6 — helpers", () => {
  it("splits paragraphs on blank lines and scores similarity", () => {
    expect(splitParagraphs("a\r\n\r\nb\n\n\n c ")).toEqual(["a", "b", "c"]);
    expect(paragraphSimilarity("The contractor shall provide monthly reports", "The contractor shall provide weekly reports")).toBeGreaterThan(0.5);
    expect(paragraphSimilarity("Zero trust architecture rollout", "Key personnel resumes")).toBe(0);
  });
});
