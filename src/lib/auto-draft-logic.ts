/**
 * BL-AIX Phase 0c — the rules of server-side auto-draft, kept pure so
 * they are unit-tested: which sections a run drafts, how a draft cut off
 * at the output limit is marked, and how a proposal's jobs read as
 * progress.
 */

/** Below this many words a section counts as empty (template placeholders included). */
export const EMPTY_WORD_THRESHOLD = 30;

/** Appended to a draft that stopped at the output limit, so nobody mistakes it for finished. */
export const TRUNCATION_NOTE = "[CONTINUE: the AI draft stopped at its length limit — finish this section.]";

export type AutoDraftCandidate = { id: string; wordCount: number };

/** Empty sections, or every section when the run may overwrite. */
export function pickAutoDraftTargets(sections: AutoDraftCandidate[], overwrite: boolean): string[] {
  return sections.filter((s) => overwrite || s.wordCount < EMPTY_WORD_THRESHOLD).map((s) => s.id);
}

export function withTruncationNote(text: string, truncated: boolean): string {
  return truncated ? `${text.trimEnd()}\n\n${TRUNCATION_NOTE}` : text;
}

export type AutoDraftJobRow = {
  resourceId: string;
  status: "queued" | "running" | "done" | "failed";
  error: string;
  payload: Record<string, unknown>;
  createdAt: Date;
};

export type AutoDraftSectionState = {
  sectionId: string;
  status: AutoDraftJobRow["status"];
  /** Why it failed, or why it was skipped. */
  note: string;
  truncated: boolean;
};

export type AutoDraftProgress = {
  total: number;
  queued: number;
  running: number;
  done: number;
  failed: number;
  /** True while anything is queued or running. */
  active: boolean;
  sections: AutoDraftSectionState[];
};

/** The newest job per section, summarised for the progress view. */
export function summarizeAutoDraft(rows: AutoDraftJobRow[]): AutoDraftProgress {
  const latest = new Map<string, AutoDraftJobRow>();
  for (const r of rows) {
    const seen = latest.get(r.resourceId);
    if (!seen || r.createdAt.getTime() > seen.createdAt.getTime()) latest.set(r.resourceId, r);
  }
  const sections = [...latest.values()].map((r) => ({
    sectionId: r.resourceId,
    status: r.status,
    note: r.status === "failed" ? r.error : typeof r.payload.skipped === "string" ? r.payload.skipped : "",
    truncated: r.payload.truncated === true,
  }));
  const count = (s: AutoDraftJobRow["status"]) => sections.filter((x) => x.status === s).length;
  const queued = count("queued");
  const running = count("running");
  return { total: sections.length, queued, running, done: count("done"), failed: count("failed"), active: queued + running > 0, sections };
}
