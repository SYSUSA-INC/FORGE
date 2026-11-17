/**
 * BL-NAV-LIFECYCLE 5d-2 — build a tenant's style note for one section kind
 * from its own edits: what was cut, what was added, the wording preferred.
 *
 * Pure: no DB, no AI call, unit-tested (tests/ai/style-note.test.ts). The
 * weekly rebuild and the reads are in src/lib/style-note.ts.
 *
 * Inputs are one tenant's rows only:
 *   - tracked-change decisions (accept / reject), with whether the
 *     suggestion came from FORGE AI, from a colour-team reviewer, or was
 *     resolved with accept-all;
 *   - AI drafts (the `ai_draft` snapshots) beside the section's text now.
 *
 * FORGE AI's own accepted text and accept-all decisions never count as
 * the team's wording, as in edit-feedback-summary.ts.
 */
import { shingleRetention } from "@/lib/ai-acceptance";
import { keptShare, measureRetention } from "@/lib/draft-learning-logic";
import { EDIT_FEEDBACK_MIN_SAMPLE, type EditDecisionInput } from "@/lib/edit-feedback-summary";

export type StyleDecision = EditDecisionInput & {
  /** The suggestion came from a reviewer on a colour-team round. */
  fromReviewer?: boolean;
};

export type StyleDraft = { sectionId: string; draftText: string; currentText: string };

export type StyleNoteBody = {
  windowDays: number;
  /** Decisions the note was built from, and how many of them were reviewers' suggestions. */
  sampleSize: number;
  reviewerDecisions: number;
  /** Passages the owners agreed to cut. */
  cut: string[];
  /** Text people added that the owners kept. */
  added: string[];
  /** Words and pairs that recur in what was kept and never in what was cut. */
  preferredWording: string[];
  /** Words and pairs that recur in what was cut or struck and never in what was kept. */
  avoidedWording: string[];
  /** Sentences FORGE AI drafted that are gone from the section now. */
  droppedFromAiDrafts: string[];
  /** Share of the AI drafts still in the text, weighted by length; null with no AI draft. */
  aiDraftKeptShare: number | null;
  aiDraftSections: number;
};

export const STYLE_NOTE_LIMITS = { phrases: 6, wording: 8, dropped: 6, droppedPerSection: 2, minWords: 4, maxChars: 160, minRecurrence: 2 } as const;

const STOP = new Set(
  "a an and are as at be been but by can could did do does for from had has have he her his how i if in into is it its may more most must not of on or our out shall she should so such than that the their them then there these they this those to was we were what when which who will with would you your also about over under all any each other only very".split(" "),
);

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function tokens(text: string): string[] {
  return text.toLowerCase().match(/[a-z][a-z'’-]*[a-z]|[a-z]/g) ?? [];
}

function clip(text: string): string {
  return text.length > STYLE_NOTE_LIMITS.maxChars ? `${text.slice(0, STYLE_NOTE_LIMITS.maxChars - 1).trimEnd()}…` : text;
}

function time(v: Date | string): number {
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Reviewers' suggestions first, then newest; one entry per distinct phrase; fragments left out. */
function pickPhrases(rows: StyleDecision[], max: number): string[] {
  const ordered = [...rows].sort((a, b) => Number(!!b.fromReviewer) - Number(!!a.fromReviewer) || time(b.createdAt) - time(a.createdAt));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of ordered) {
    const text = normalize(row.text);
    if (tokens(text).length < STYLE_NOTE_LIMITS.minWords) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clip(text));
    if (out.length >= max) break;
  }
  return out;
}

/** The content words and adjacent content-word pairs of one phrase, each once. */
function terms(text: string): Set<string> {
  const words = tokens(text);
  const out = new Set<string>();
  words.forEach((word, i) => {
    const content = word.length >= 4 && !STOP.has(word);
    if (content) out.add(word);
    const next = words[i + 1];
    if (content && next && next.length >= 4 && !STOP.has(next)) out.add(`${word} ${next}`);
  });
  return out;
}

/**
 * Terms found in at least `minRecurrence` phrases of `mine` and in none of
 * `theirs`. Pairs before single words; a word already inside a chosen pair
 * is not repeated.
 */
export function recurringWording(mine: string[], theirs: string[], max: number = STYLE_NOTE_LIMITS.wording): string[] {
  const count = new Map<string, number>();
  for (const phrase of mine) for (const term of terms(phrase)) count.set(term, (count.get(term) ?? 0) + 1);
  const excluded = new Set<string>();
  for (const phrase of theirs) for (const term of terms(phrase)) excluded.add(term);
  const ranked = [...count.entries()]
    .filter(([term, n]) => n >= STYLE_NOTE_LIMITS.minRecurrence && !excluded.has(term))
    .sort((a, b) => Number(b[0].includes(" ")) - Number(a[0].includes(" ")) || b[1] - a[1] || a[0].localeCompare(b[0]));
  const out: string[] = [];
  for (const [term] of ranked) {
    if (!term.includes(" ") && out.some((chosen) => chosen.split(" ").includes(term))) continue;
    out.push(term);
    if (out.length >= max) break;
  }
  return out;
}

/** Sentences of an AI draft with no four-word run left in the section's text. */
export function droppedSentences(draftText: string, currentText: string, max: number = STYLE_NOTE_LIMITS.droppedPerSection): string[] {
  const out: string[] = [];
  for (const raw of draftText.split(/(?<=[.!?])\s+|\n+/)) {
    const sentence = normalize(raw);
    if (tokens(sentence).length < 6) continue;
    if (shingleRetention(sentence, currentText).fraction > 0) continue;
    out.push(clip(sentence));
    if (out.length >= max) break;
  }
  return out;
}

/** Null below the minimum sample: too few decisions say nothing about a team's taste. */
export function buildStyleNote(input: { decisions: StyleDecision[]; drafts: StyleDraft[]; windowDays: number }): StyleNoteBody | null {
  const decisions = input.decisions;
  if (decisions.length < EDIT_FEEDBACK_MIN_SAMPLE) return null;

  const one = decisions.filter((d) => !d.bulk);
  const keptAdditions = one.filter((d) => d.changeType === "insert" && d.decision === "accept" && !d.fromAi);
  const cuts = one.filter((d) => d.changeType === "delete" && d.decision === "accept");
  const struck = decisions.filter((d) => d.changeType === "insert" && d.decision === "reject");

  const keptText = keptAdditions.map((d) => d.text);
  const goneText = [...cuts, ...struck].map((d) => d.text);

  const dropped: string[] = [];
  for (const draft of input.drafts) {
    for (const sentence of droppedSentences(draft.draftText, draft.currentText)) {
      if (dropped.length < STYLE_NOTE_LIMITS.dropped && !dropped.includes(sentence)) dropped.push(sentence);
    }
  }
  const measured = measureRetention(input.drafts);

  return {
    windowDays: input.windowDays,
    sampleSize: decisions.length,
    reviewerDecisions: decisions.filter((d) => d.fromReviewer).length,
    cut: pickPhrases(cuts, STYLE_NOTE_LIMITS.phrases),
    added: pickPhrases(keptAdditions, STYLE_NOTE_LIMITS.phrases),
    preferredWording: recurringWording(keptText, goneText),
    avoidedWording: recurringWording(goneText, keptText),
    droppedFromAiDrafts: dropped,
    aiDraftKeptShare: keptShare(measured),
    aiDraftSections: measured.length,
  };
}

/** A stored body read back: anything not shaped like a note is no note. */
export function parseStyleNoteBody(value: unknown): StyleNoteBody | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const list = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);
  if (typeof v.sampleSize !== "number" || v.sampleSize < EDIT_FEEDBACK_MIN_SAMPLE) return null;
  return {
    windowDays: typeof v.windowDays === "number" ? v.windowDays : 0,
    sampleSize: v.sampleSize,
    reviewerDecisions: typeof v.reviewerDecisions === "number" ? v.reviewerDecisions : 0,
    cut: list(v.cut),
    added: list(v.added),
    preferredWording: list(v.preferredWording),
    avoidedWording: list(v.avoidedWording),
    droppedFromAiDrafts: list(v.droppedFromAiDrafts),
    aiDraftKeptShare: typeof v.aiDraftKeptShare === "number" ? v.aiDraftKeptShare : null,
    aiDraftSections: typeof v.aiDraftSections === "number" ? v.aiDraftSections : 0,
  };
}

/** What the drafter is shown of a note: the lists, not the bookkeeping. */
export type StyleNoteView = Pick<StyleNoteBody, "cut" | "added" | "preferredWording" | "avoidedWording" | "droppedFromAiDrafts"> & {
  sectionKind: string;
  builtAt: string;
};

export function hasStyleContent(body: StyleNoteBody): boolean {
  return body.cut.length + body.added.length + body.preferredWording.length + body.avoidedWording.length + body.droppedFromAiDrafts.length > 0;
}
