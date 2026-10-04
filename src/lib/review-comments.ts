/**
 * BL-AIP-6b — colour-team review comments as the editor shows them,
 * pure parts.
 *
 * Reviewers (and, since BL-AIP-6, the FORGE AI pre-review) leave
 * comments on sections from the review page; the drafter already reads
 * the open ones as writing signals. Now the writer sees them in the
 * editor, next to the text they are about, and can resolve them there —
 * which is what takes them out of the drafter's signals too.
 */
import type { ReviewColor } from "@/db/schema";

/** How `review-preflight.ts` prefixes an AI comment body. */
export const AI_REVIEW_PREFIX = "[FORGE AI pre-review";

export type ReviewSeverity = "high" | "medium" | "low";

export const REVIEW_COLOR_LABELS: Record<ReviewColor, string> = {
  pink: "Pink Team",
  red: "Red Team",
  gold: "Gold Team",
  white_gloves: "White Gloves",
  green: "Green Team",
};

export type SectionReviewComment = {
  id: string;
  reviewId: string;
  sectionId: string;
  color: ReviewColor;
  body: string;
  /** null = written by the FORGE AI pre-review. */
  authorName: string | null;
  createdAt: string;
  /** BL-FB-X-COLOR-TEAM Slice 3 — the earlier round this comment was carried forward from, when it was. */
  carriedFrom?: { reviewId: string; color: ReviewColor } | null;
};

export type ParsedReviewBody = {
  ai: boolean;
  severity: ReviewSeverity | null;
  text: string;
};

/** Split an AI pre-review body into its severity and text; a human body passes through. */
export function parseReviewBody(body: string): ParsedReviewBody {
  const m = /^\[FORGE AI pre-review(?:\s*·\s*(high|medium|low))?\]\s*/i.exec(body);
  if (!m) return { ai: false, severity: null, text: body.trim() };
  const sev = m[1]?.toLowerCase();
  return {
    ai: true,
    severity: sev === "high" || sev === "medium" || sev === "low" ? sev : null,
    text: body.slice(m[0].length).trim(),
  };
}

/** Rows grouped by section, in the order given. */
export function groupBySection<T extends { sectionId: string | null }>(rows: readonly T[]): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const r of rows) {
    if (!r.sectionId) continue;
    (out[r.sectionId] ??= []).push(r);
  }
  return out;
}

/** "2 open review comments · 1 from FORGE AI" for the section row. */
export function describeOpenComments(list: readonly { authorName: string | null }[]): string {
  if (list.length === 0) return "";
  const ai = list.filter((c) => c.authorName === null).length;
  const base = `${list.length} open review comment${list.length === 1 ? "" : "s"}`;
  return ai > 0 ? `${base} · ${ai} from FORGE AI` : base;
}
