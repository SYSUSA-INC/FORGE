/**
 * BL-AIX Phase 0c — server-side auto-draft rules: which sections a run
 * drafts, how a cut-off draft is marked, how jobs read as progress.
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_WORD_THRESHOLD,
  pickAutoDraftTargets,
  summarizeAutoDraft,
  TRUNCATION_NOTE,
  withTruncationNote,
  type AutoDraftJobRow,
} from "@/lib/auto-draft-logic";

describe("pickAutoDraftTargets", () => {
  const sections = [
    { id: "empty", wordCount: 0 },
    { id: "placeholder", wordCount: EMPTY_WORD_THRESHOLD - 1 },
    { id: "written", wordCount: 400 },
  ];
  it("drafts empty sections, and every section only when overwriting", () => {
    expect(pickAutoDraftTargets(sections, false)).toEqual(["empty", "placeholder"]);
    expect(pickAutoDraftTargets(sections, true)).toEqual(["empty", "placeholder", "written"]);
  });
});

describe("withTruncationNote", () => {
  it("marks a draft cut off at the length limit and leaves others alone", () => {
    expect(withTruncationNote("Our approach…  ", true)).toBe(`Our approach…\n\n${TRUNCATION_NOTE}`);
    expect(withTruncationNote("Done.", false)).toBe("Done.");
  });
});

describe("summarizeAutoDraft", () => {
  const at = (m: number) => new Date(Date.UTC(2026, 9, 5, 12, m));
  const row = (resourceId: string, status: AutoDraftJobRow["status"], m: number, extra: Partial<AutoDraftJobRow> = {}): AutoDraftJobRow => ({
    resourceId,
    status,
    error: "",
    payload: {},
    createdAt: at(m),
    ...extra,
  });

  it("reads the newest job per section", () => {
    const p = summarizeAutoDraft([
      row("a", "failed", 0, { error: "AI request failed." }),
      row("a", "done", 5, { payload: { truncated: true } }),
      row("b", "running", 1),
      row("c", "queued", 2),
      row("d", "done", 3, { payload: { skipped: "Already has text — skipped." } }),
      row("e", "failed", 4, { error: "AI is in stub mode, so nothing was written." }),
    ]);
    expect(p).toMatchObject({ total: 5, done: 2, running: 1, queued: 1, failed: 1, active: true });
    const by = Object.fromEntries(p.sections.map((s) => [s.sectionId, s]));
    expect(by.a).toMatchObject({ status: "done", truncated: true, note: "" });
    expect(by.d!.note).toBe("Already has text — skipped.");
    expect(by.e!.note).toContain("stub mode");
  });

  it("is inactive once nothing is queued or running", () => {
    expect(summarizeAutoDraft([row("a", "done", 0), row("b", "failed", 1)]).active).toBe(false);
    expect(summarizeAutoDraft([])).toMatchObject({ total: 0, active: false });
  });
});
