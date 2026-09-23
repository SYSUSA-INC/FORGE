/**
 * BL-9 Slice 7 — turn a list of track-changes decisions into the compact
 * summary the section drafter reads.
 *
 * Pure: no DB, no server-only, so it is unit-tested directly
 * (tests/ai/edit-feedback.test.ts). The database read that feeds it
 * lives in src/lib/edit-feedback.ts.
 *
 * What the drafter learns from it:
 *   - preferredPhrases — text a contributor added that the section
 *     owner kept. The register, specificity and claims to match.
 *   - rejectedPhrases  — insertions the owner struck. Do not reproduce.
 *   - removedPhrases   — existing text the owner agreed to cut. The
 *     padding a draft should not produce in the first place.
 *   - insert / delete acceptance rates — how strict this team is.
 */

export type EditDecisionInput = {
  changeType: "insert" | "delete";
  decision: "accept" | "reject";
  text: string;
  createdAt: Date | string;
};

export type EditFeedbackSummary = {
  /** Decisions the summary was built from. */
  sampleSize: number;
  /** How far back the sample reaches, for the model's context. */
  windowDays: number;
  /** Accepted insertions ÷ all resolved insertions; null with no insertions. */
  insertAcceptRate: number | null;
  /** Accepted deletions ÷ all resolved deletions; null with no deletions. */
  deleteAcceptRate: number | null;
  preferredPhrases: string[];
  rejectedPhrases: string[];
  removedPhrases: string[];
};

/** Below this many decisions the signal is noise; callers get null. */
export const EDIT_FEEDBACK_MIN_SAMPLE = 5;

export type SummarizeOptions = {
  windowDays?: number;
  /** Per list. */
  maxPhrases?: number;
  /** Fragments shorter than this are typo fixes, not phrasing. */
  minWords?: number;
  /** Longer phrases are cut with an ellipsis. */
  maxChars?: number;
};

const DEFAULTS: Required<SummarizeOptions> = {
  windowDays: 180,
  maxPhrases: 6,
  minWords: 4,
  maxChars: 160,
};

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function toTime(v: Date | string): number {
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Most recent first, one entry per distinct phrase (case-insensitive),
 * skipping fragments shorter than `minWords`, capped at `maxPhrases`.
 */
function pickPhrases(
  rows: EditDecisionInput[],
  keep: (r: EditDecisionInput) => boolean,
  opts: Required<SummarizeOptions>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    if (!keep(r)) continue;
    const text = normalize(r.text);
    if (countWords(text) < opts.minWords) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text.length > opts.maxChars ? `${text.slice(0, opts.maxChars - 1).trimEnd()}…` : text);
    if (out.length >= opts.maxPhrases) break;
  }
  return out;
}

function rate(rows: EditDecisionInput[], type: "insert" | "delete"): number | null {
  const ofType = rows.filter((r) => r.changeType === type);
  if (ofType.length === 0) return null;
  const accepted = ofType.filter((r) => r.decision === "accept").length;
  return accepted / ofType.length;
}

export function summarizeEditDecisions(
  input: EditDecisionInput[],
  options: SummarizeOptions = {},
): EditFeedbackSummary | null {
  if (input.length < EDIT_FEEDBACK_MIN_SAMPLE) return null;
  const opts = { ...DEFAULTS, ...options };
  const rows = [...input].sort((a, b) => toTime(b.createdAt) - toTime(a.createdAt));

  return {
    sampleSize: rows.length,
    windowDays: opts.windowDays,
    insertAcceptRate: rate(rows, "insert"),
    deleteAcceptRate: rate(rows, "delete"),
    preferredPhrases: pickPhrases(
      rows,
      (r) => r.changeType === "insert" && r.decision === "accept",
      opts,
    ),
    rejectedPhrases: pickPhrases(
      rows,
      (r) => r.changeType === "insert" && r.decision === "reject",
      opts,
    ),
    removedPhrases: pickPhrases(
      rows,
      (r) => r.changeType === "delete" && r.decision === "accept",
      opts,
    ),
  };
}
