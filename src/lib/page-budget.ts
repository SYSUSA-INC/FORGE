/**
 * BL-FB-SCAN-PAGE-REALTIME — live page budget for a section.
 *
 * Pages are estimated from the word count at the same density the
 * drafter and the health scan assume (350 words per prose page), so the
 * ring in the section header, the "aim for the page cap" instruction
 * and the THIN flag all agree. Pure; unit-tested.
 */

/** Words per prose page — the assumption shared with `ai-prompts.ts` and the scan. */
export const WORDS_PER_PAGE = 350;

/** Fraction of the cap at which the ring turns amber. */
export const NEAR_CAP_RATIO = 0.9;
/** Below this fraction of the cap the section still reads as thin (the scan's THIN_RATIO). */
export const THIN_RATIO = 0.6;

export type PageBudgetState = "none" | "empty" | "thin" | "ok" | "near" | "over";

export type PageBudget = {
  /** Estimated pages, one decimal. */
  pages: number;
  /** The section's cap, or null when none is set. */
  cap: number | null;
  /** pages / cap, or null without a cap. */
  ratio: number | null;
  /** Pages over the cap (0 when within). */
  overBy: number;
  state: PageBudgetState;
  /** "4.2 / 3 pages" (or "1.2 pages" without a cap). */
  label: string;
  /** "Over the cap by 1.2 pages — Tighten can cut it." */
  description: string;
};

/** Estimated pages for a word count, to one decimal. */
export function estimatePages(words: number, wordsPerPage: number = WORDS_PER_PAGE): number {
  const w = Math.max(0, Math.floor(words));
  const per = wordsPerPage > 0 ? wordsPerPage : WORDS_PER_PAGE;
  return Math.round((w / per) * 10) / 10;
}

/** Words that fit the cap at the shared density. */
export function wordsForPages(pages: number, wordsPerPage: number = WORDS_PER_PAGE): number {
  return Math.max(0, Math.round(pages * (wordsPerPage > 0 ? wordsPerPage : WORDS_PER_PAGE)));
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** A valid page cap or null; the editor's cap input is free text. */
export function normalizePageCap(cap: number | string | null | undefined): number | null {
  if (cap === null || cap === undefined) return null;
  const n = typeof cap === "string" ? Number(cap.trim()) : cap;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 10) / 10;
}

export function pageBudget(words: number, cap: number | string | null | undefined): PageBudget {
  const pages = estimatePages(words);
  const limit = normalizePageCap(cap);
  if (limit === null) {
    return {
      pages,
      cap: null,
      ratio: null,
      overBy: 0,
      state: "none",
      label: `${fmt(pages)} page${pages === 1 ? "" : "s"}`,
      description: `About ${fmt(pages)} page${pages === 1 ? "" : "s"} at ${WORDS_PER_PAGE} words per page. No page cap is set for this section.`,
    };
  }
  const ratio = pages / limit;
  const overBy = Math.max(0, Math.round((pages - limit) * 10) / 10);
  const state: PageBudgetState =
    words <= 0
      ? "empty"
      : ratio > 1
        ? "over"
        : ratio >= NEAR_CAP_RATIO
          ? "near"
          : ratio < THIN_RATIO
            ? "thin"
            : "ok";
  const label = `${fmt(pages)} / ${fmt(limit)} page${limit === 1 ? "" : "s"}`;
  const room = wordsForPages(limit) - Math.max(0, Math.floor(words));
  const description =
    state === "empty"
      ? `Nothing written yet. The cap is ${fmt(limit)} page${limit === 1 ? "" : "s"} (about ${wordsForPages(limit).toLocaleString("en-US")} words).`
      : state === "over"
        ? `Over the cap by ${fmt(overBy)} page${overBy === 1 ? "" : "s"} (about ${Math.abs(room).toLocaleString("en-US")} words). Tighten can cut it to fit.`
        : state === "near"
          ? `Near the cap: about ${room.toLocaleString("en-US")} words of room left.`
          : state === "thin"
            ? `Well under the cap: about ${room.toLocaleString("en-US")} words of room. The health scan flags sections under ${Math.round(THIN_RATIO * 100)}% of their cap as thin.`
            : `Within the cap: about ${room.toLocaleString("en-US")} words of room left.`;
  return { pages, cap: limit, ratio, overBy, state, label, description };
}

/** Ring fill, 0..1 (full when at or over the cap). */
export function ringFill(budget: PageBudget): number {
  if (budget.ratio === null) return 0;
  return Math.min(1, Math.max(0, budget.ratio));
}
