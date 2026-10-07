/**
 * BL-AIX Phase 2a — segmenting a solicitation by its headings, and
 * planning the requirement sweep's windows around the segments.
 */
import { describe, expect, it } from "vitest";
import { chunkText } from "@/lib/requirements-text";
import { paragraphAt, paragraphMarks, planSweepWindows, segmentAt, segmentSolicitation } from "@/lib/solicitation-segments";
import { ucfSolicitation } from "../helpers/ucf-solicitation";

describe("BL-AIX Phase 2a — solicitation segments", () => {
  it("finds the UCF sections and appended attachments, past the contents, running headers and cross-references", () => {
    const { text } = ucfSolicitation();
    const segments = segmentSolicitation(text);
    expect(segments.map((s) => s.key)).toEqual(["", "B", "C", "J", "L", "M", "Attachment J-1", "Attachment J-2"]);
    const c = segments.find((s) => s.key === "C")!;
    expect(text.slice(c.start).startsWith("SECTION C - DESCRIPTION")).toBe(true);
    expect(c.label).toBe("Section C — Description/specifications/statement of work");
    // "Section C - Page 3" and "Section L of this solicitation …" stay inside C.
    expect(segmentAt(segments, text.indexOf("C.4 The contractor"))!.key).toBe("C");
    expect(segments.find((s) => s.key === "Attachment J-1")!.label).toBe("Attachment J-1 — PERFORMANCE WORK STATEMENT");
  });

  it("tiles the text end to end", () => {
    const { text } = ucfSolicitation();
    const segments = segmentSolicitation(text);
    expect(segments[0]!.start).toBe(0);
    expect(segments[segments.length - 1]!.end).toBe(text.length);
    for (let i = 1; i < segments.length; i++) expect(segments[i]!.start).toBe(segments[i - 1]!.end);
  });

  it("does not take a cover letter's list of attachments for the attachments", () => {
    const text = [
      "REQUEST FOR QUOTE 47QTCA-26-Q-0007",
      "The following are attached:",
      "Attachment 1 - Statement of Work",
      "Attachment 2 - Pricing Sheet",
      "Attachment 3 - Past Performance Form",
      "Quotes are due on 12 November.",
      "",
      "ATTACHMENT 1 - STATEMENT OF WORK",
      "1.0 SCOPE",
      "The contractor shall migrate 400 mailboxes.",
      "ATTACHMENT 2 - PRICING SHEET",
      "Enter a firm fixed price per CLIN.",
    ].join("\n");
    const segments = segmentSolicitation(text);
    expect(segments.map((s) => s.key)).toEqual(["", "Attachment 1", "Attachment 2"]);
    expect(text.slice(segments[1]!.start).startsWith("ATTACHMENT 1 - STATEMENT OF WORK")).toBe(true);
  });

  it("leaves a document without that structure as one segment", () => {
    const text = "The contractor shall provide cloud hosting.\nThe contractor shall report monthly.";
    expect(segmentSolicitation(text)).toEqual([{ kind: "front", key: "", label: "Front matter", start: 0, end: text.length }]);
    expect(segmentSolicitation("")).toEqual([]);
  });

  it("reads numbered paragraph headings as written, and only within the same part", () => {
    const { text } = ucfSolicitation();
    const marks = paragraphMarks(text);
    const labels = marks.map((m) => m.label);
    expect(labels).toEqual(expect.arrayContaining(["B.1", "C.1", "3.2.1", "C.4", "L.5", "M.1", "PWS 2.1"]));
    expect(paragraphMarks("1.5 million dollars is the ceiling.\n2.0 GENERAL\n10.1.2.3 Detail\n4.1. Configure in Settings").map((m) => m.label)).toEqual([
      "2.0",
      "10.1.2.3",
      "4.1",
    ]);
    const segments = segmentSolicitation(text);
    const at = text.indexOf("plete transition");
    expect(paragraphAt(marks, at, segmentAt(segments, at))).toBe("3.2.1");
    // The first line of Section L has no paragraph of its own before it in L.
    const l = segments.find((s) => s.key === "L")!;
    expect(paragraphAt(marks, l.start, l)).toBeNull();
  });
});

describe("BL-AIX Phase 2a — sweep windows", () => {
  const small = { chunkChars: 400, overlapChars: 40 };

  it("keeps a part that fits in one window, packs small parts together and labels each window", () => {
    const { text } = ucfSolicitation();
    const segments = segmentSolicitation(text);
    const windows = planSweepWindows(text, segments, small);
    expect(windows[0]!.start).toBe(0);
    expect(windows[windows.length - 1]!.end).toBe(text.length);
    for (let i = 1; i < windows.length; i++) expect(windows[i]!.start).toBeLessThanOrEqual(windows[i - 1]!.end);
    // No part that fits a window is cut.
    for (const s of segments.filter((g) => g.end - g.start <= small.chunkChars)) {
      expect(windows.some((w) => w.start <= s.start && w.end >= s.end), s.key).toBe(true);
    }
    const lm = windows.find((w) => w.text.includes("L.5 Volume I"))!;
    expect(lm.label).toMatch(/^Several parts: (?:.*, )?L\b|^Section L/);
    expect(windows.every((w) => w.text === text.slice(w.start, w.end))).toBe(true);
  });

  it("reads an unstructured document exactly as before, unlabelled", () => {
    const text = Array.from({ length: 40 }, (_, i) => `The contractor shall do task ${i}.`).join("\n");
    const windows = planSweepWindows(text, segmentSolicitation(text), small);
    expect(windows.map((w) => [w.start, w.end])).toEqual(chunkText(text, small).map((c) => [c.start, c.end]));
    expect(windows.every((w) => w.label === "")).toBe(true);
  });

  it("falls back to the plain cut when following the parts would need more windows than the cap", () => {
    const body = "The contractor shall comply with this exhibit in full and on time. ".repeat(4);
    const text = Array.from({ length: 14 }, (_, i) => `EXHIBIT ${i + 1} - PART ${i + 1}\n${body}`).join("\n");
    const segments = segmentSolicitation(text);
    expect(segments.filter((s) => s.kind === "attachment")).toHaveLength(14);
    const windows = planSweepWindows(text, segments, { chunkChars: 400, overlapChars: 40 });
    expect(windows.map((w) => [w.start, w.end])).toEqual(chunkText(text, { chunkChars: 400, overlapChars: 40 }).map((c) => [c.start, c.end]));
  });
});
