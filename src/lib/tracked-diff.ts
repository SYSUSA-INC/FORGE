/**
 * BL-AIP-6 — AI output as tracked changes.
 *
 * "Replace section with this" swapped the whole body for a flat
 * paragraph list: tables, lists, links, bold, pending suggestions and
 * comment anchors were gone, and nothing recorded whether the owner
 * kept what the AI wrote. This module turns a proposed rewrite into the
 * same TcInsert / TcDelete marks a human contributor leaves in Suggest
 * mode, authored "FORGE AI", so the owner accepts or rejects change by
 * change and every decision lands in `section_change_decision`.
 *
 * Alignment is block-first, then word-level inside a changed block:
 *   1. Top-level blocks are matched to the proposal's paragraphs by
 *      normalised text (jsdiff `diffArrays`). Unchanged blocks are kept
 *      byte-for-byte — a table or list the AI did not touch survives.
 *   2. A removed block and an added paragraph that line up are paired
 *      when they still resemble each other; their texts are diffed word
 *      by word and the original inline runs (bold, links…) are preserved
 *      for the unchanged words.
 *   3. Anything else is a whole-block deletion (text struck, structure
 *      kept) or a new paragraph inserted.
 *
 * Invariants (tested): accept-all yields the proposal's text; reject-all
 * yields the original document.
 *
 * Pure: no DB, no server-only. Safe for the client bundle.
 */
import { diffArrays, diffWordsWithSpace } from "diff";
import type { TipTapDoc, TipTapNode } from "@/db/schema";
import { blockPlainText, rejectTrackedChanges } from "@/lib/tiptap-doc";
import { THEME } from "@/lib/theme-colors";

export type TrackedAuthor = { id: string; name: string; color: string };

/** The author every AI-originated tracked change carries. */
export const FORGE_AI_AUTHOR: TrackedAuthor = {
  id: "forge-ai",
  name: "FORGE AI",
  color: THEME.indigo,
};

export function isAiAuthor(authorId: string | null | undefined): boolean {
  return authorId === FORGE_AI_AUTHOR.id;
}

export type TrackedDiffResult = {
  doc: TipTapDoc;
  /** Distinct change ids created. */
  changes: number;
  insertedWords: number;
  deletedWords: number;
  /** Blocks kept without any change. */
  untouchedBlocks: number;
};

type InlineRun = {
  kind: "text" | "hardBreak";
  text: string;
  marks: TipTapNode["marks"];
  /** The original node, for hardBreak passthrough. */
  node?: TipTapNode;
};

type IdFactory = () => string;

function defaultIdFactory(): IdFactory {
  let n = 0;
  return () =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `ai-${Date.now().toString(36)}-${(n++).toString(36)}`;
}

function tcMark(type: "tcInsert" | "tcDelete", id: string, author: TrackedAuthor, ts: number) {
  return {
    type,
    attrs: {
      "data-tc-id": id,
      "data-tc-author-id": author.id,
      "data-tc-author-name": author.name,
      "data-tc-author-color": author.color,
      "data-tc-ts": String(ts),
    },
  };
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function countWords(text: string): number {
  return text.split(/\s+/g).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

function tokenSet(text: string): Set<string> {
  return new Set(normalize(text).split(/\W+/).filter((t) => t.length > 2));
}

/** Token overlap used to decide whether two paragraphs are "the same one, edited". */
export function paragraphSimilarity(a: string, b: string): number {
  const sa = tokenSet(a);
  const sb = tokenSet(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 0 : inter / union;
}

const PAIR_THRESHOLD = 0.3;

/** Split a rewrite into paragraphs the way fromPlainText does. */
export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n{2,}/g)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Flatten a paragraph-like block into inline runs; null when it holds nested blocks. */
function inlineRuns(block: TipTapNode): InlineRun[] | null {
  const runs: InlineRun[] = [];
  for (const n of block.content ?? []) {
    if (n.type === "text") {
      runs.push({ kind: "text", text: n.text ?? "", marks: n.marks });
    } else if (n.type === "hardBreak") {
      runs.push({ kind: "hardBreak", text: "\n", marks: undefined, node: n });
    } else {
      return null;
    }
  }
  return runs;
}

function isTrackMark(m: { type: string }): boolean {
  return m.type === "tcInsert" || m.type === "tcDelete";
}

/** Strip pending marks (the block is diffed in its final view). */
function runsWithoutTracking(runs: InlineRun[]): InlineRun[] {
  return runs
    .filter((r) => !(r.marks ?? []).some((m) => m.type === "tcDelete"))
    .map((r) => ({ ...r, marks: (r.marks ?? []).filter((m) => !isTrackMark(m)) }));
}

/** Take `count` characters from the front of `runs`, splitting a run when needed. */
function takeChars(runs: InlineRun[], count: number): { taken: InlineRun[]; rest: InlineRun[] } {
  const taken: InlineRun[] = [];
  let remaining = count;
  let i = 0;
  for (; i < runs.length && remaining > 0; i++) {
    const r = runs[i]!;
    if (r.text.length <= remaining) {
      taken.push(r);
      remaining -= r.text.length;
    } else {
      taken.push({ ...r, text: r.text.slice(0, remaining) });
      const tail = { ...r, text: r.text.slice(remaining) };
      return { taken, rest: [tail, ...runs.slice(i + 1)] };
    }
  }
  return { taken, rest: runs.slice(i) };
}

function runsToNodes(runs: InlineRun[], extraMark?: ReturnType<typeof tcMark>): TipTapNode[] {
  const out: TipTapNode[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    if (r.kind === "hardBreak") {
      out.push(r.node ?? { type: "hardBreak" });
      continue;
    }
    const marks = [...(r.marks ?? []), ...(extraMark ? [extraMark] : [])];
    out.push(marks.length ? { type: "text", text: r.text, marks } : { type: "text", text: r.text });
  }
  return out;
}

function paragraphOf(text: string, marks?: ReturnType<typeof tcMark>): TipTapNode {
  const lines = text.split("\n");
  const content: TipTapNode[] = [];
  lines.forEach((line, i) => {
    if (i > 0) content.push({ type: "hardBreak" });
    if (line) content.push(marks ? { type: "text", text: line, marks: [marks] } : { type: "text", text: line });
  });
  return { type: "paragraph", content };
}

/** Wrap every text node of a block in a tcDelete mark, keeping structure. */
function markBlockDeleted(block: TipTapNode, mark: ReturnType<typeof tcMark>): TipTapNode {
  const walk = (n: TipTapNode): TipTapNode => {
    if (n.type === "text") {
      const marks = (n.marks ?? []).filter((m) => m.type !== "tcInsert" && m.type !== "tcDelete");
      return { ...n, marks: [...marks, mark] };
    }
    if (!n.content) return n;
    return { ...n, content: n.content.map(walk) };
  };
  return walk(block);
}

/**
 * Word-level tracked diff of one paragraph-like block against new text.
 * Unchanged words keep their original inline marks.
 */
function diffBlockInline(
  block: TipTapNode,
  runs: InlineRun[],
  nextText: string,
  author: TrackedAuthor,
  ts: number,
  nextId: IdFactory,
  stats: { changes: number; insertedWords: number; deletedWords: number },
): TipTapNode {
  const original = runs.map((r) => r.text).join("");
  const parts = diffWordsWithSpace(original, nextText);
  let rest = runs;
  const content: TipTapNode[] = [];
  for (const part of parts) {
    if (part.added) {
      const id = nextId();
      stats.changes += 1;
      stats.insertedWords += countWords(part.value);
      const lines = part.value.split("\n");
      lines.forEach((line, i) => {
        if (i > 0) content.push({ type: "hardBreak" });
        if (line) content.push({ type: "text", text: line, marks: [tcMark("tcInsert", id, author, ts)] });
      });
      continue;
    }
    const { taken, rest: after } = takeChars(rest, part.value.length);
    rest = after;
    if (part.removed) {
      const id = nextId();
      stats.changes += 1;
      stats.deletedWords += countWords(part.value);
      content.push(...runsToNodes(taken, tcMark("tcDelete", id, author, ts)));
    } else {
      content.push(...runsToNodes(taken));
    }
  }
  return { ...block, content };
}

/**
 * Express `proposedText` as tracked changes on top of `doc`.
 */
export function applyAsTrackedChanges(input: {
  doc: TipTapDoc;
  proposedText: string;
  author?: TrackedAuthor;
  now?: number;
  idFactory?: IdFactory;
}): TrackedDiffResult {
  const author = input.author ?? FORGE_AI_AUTHOR;
  const ts = input.now ?? Date.now();
  const nextId = input.idFactory ?? defaultIdFactory();
  const stats = { changes: 0, insertedWords: 0, deletedWords: 0 };

  // Pending human suggestions are settled to their original view first:
  // the AI wrote against the final view, but we cannot express a change
  // on top of another change, so earlier suggestions are dropped in
  // favour of one consistent set. Callers warn when that happens.
  const base = rejectTrackedChanges(input.doc);
  const blocks = base.content ?? [];
  const blockTexts = blocks.map((b) => normalize(blockPlainText(b)));
  const proposed = splitParagraphs(input.proposedText);
  const proposedNorm = proposed.map(normalize);

  const groups = diffArrays(blockTexts, proposedNorm);
  const out: TipTapNode[] = [];
  let bi = 0; // index into blocks
  let pi = 0; // index into proposed
  let untouched = 0;

  // Walk the diff, pairing a removed run with the added run that follows it.
  for (let g = 0; g < groups.length; g++) {
    const part = groups[g]!;
    if (!part.added && !part.removed) {
      for (let k = 0; k < part.count!; k++) {
        out.push(blocks[bi++]!);
        pi++;
        untouched++;
      }
      continue;
    }
    if (part.removed) {
      const removed = blocks.slice(bi, bi + part.count!);
      bi += part.count!;
      let added: string[] = [];
      const next = groups[g + 1];
      if (next && next.added) {
        added = proposed.slice(pi, pi + next.count!);
        pi += next.count!;
        g++;
      }
      // Pair in order while the texts resemble each other.
      let ai = 0;
      for (const block of removed) {
        const candidate = added[ai];
        const runs = inlineRuns(block);
        const blockText = blockPlainText(block);
        if (candidate !== undefined && runs && paragraphSimilarity(blockText, candidate) >= PAIR_THRESHOLD) {
          out.push(diffBlockInline(block, runsWithoutTracking(runs), candidate, author, ts, nextId, stats));
          ai++;
          continue;
        }
        const id = nextId();
        stats.changes += 1;
        stats.deletedWords += countWords(blockText);
        out.push(markBlockDeleted(block, tcMark("tcDelete", id, author, ts)));
      }
      for (; ai < added.length; ai++) {
        const id = nextId();
        stats.changes += 1;
        stats.insertedWords += countWords(added[ai]!);
        out.push(paragraphOf(added[ai]!, tcMark("tcInsert", id, author, ts)));
      }
      continue;
    }
    // Pure addition.
    for (let k = 0; k < part.count!; k++) {
      const text = proposed[pi++]!;
      const id = nextId();
      stats.changes += 1;
      stats.insertedWords += countWords(text);
      out.push(paragraphOf(text, tcMark("tcInsert", id, author, ts)));
    }
  }

  return {
    doc: { type: "doc", content: out },
    changes: stats.changes,
    insertedWords: stats.insertedWords,
    deletedWords: stats.deletedWords,
    untouchedBlocks: untouched,
  };
}

/**
 * Append `text` as new paragraphs marked inserted by `author` (Brain
 * "insert", chat "append"). Existing content, including pending
 * suggestions, is left exactly as it is.
 */
export function appendAsTrackedInsertion(input: {
  doc: TipTapDoc;
  text: string;
  author?: TrackedAuthor;
  now?: number;
  idFactory?: IdFactory;
}): TrackedDiffResult {
  const author = input.author ?? FORGE_AI_AUTHOR;
  const ts = input.now ?? Date.now();
  const nextId = input.idFactory ?? defaultIdFactory();
  const paras = splitParagraphs(input.text);
  const id = nextId();
  const added = paras.map((p) => paragraphOf(p, tcMark("tcInsert", id, author, ts)));
  const insertedWords = paras.reduce((n, p) => n + countWords(p), 0);
  return {
    doc: { type: "doc", content: [...(input.doc.content ?? []), ...added] },
    changes: paras.length > 0 ? 1 : 0,
    insertedWords,
    deletedWords: 0,
    untouchedBlocks: (input.doc.content ?? []).length,
  };
}
