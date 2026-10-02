/**
 * BL-FB-CHAT-SIDEBYSIDE — a chat reply previewed as edits to the draft.
 *
 * The side-by-side layout puts the chat on the left and the draft on the
 * right. A reply that reads as a rewrite is shown against the draft
 * paragraph by paragraph — kept, new, removed or edited (with the words
 * that change) — while it streams, and the author picks which paragraphs
 * to take before they land as tracked changes. The alignment is the one
 * `applyAsTrackedChanges` uses (normalised paragraphs; a removed run
 * paired with the added run that follows while the texts resemble each
 * other), so the preview is what the editor will then show. Pure.
 */
import { diffArrays, diffWordsWithSpace } from "diff";
import { PAIR_THRESHOLD, paragraphSimilarity, splitParagraphs } from "@/lib/tracked-diff";

export type WordPart = { text: string; kind: "equal" | "added" | "removed" };

export type PreviewOp =
  | { kind: "equal"; index: number; before: string; after: string }
  | { kind: "insert"; index: number; after: string }
  | { kind: "delete"; index: number; before: string }
  | { kind: "replace"; index: number; before: string; after: string; words: WordPart[] };

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function countWords(text: string): number {
  return text.split(/\s+/g).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Word-level parts of an edited paragraph. */
export function wordParts(before: string, after: string): WordPart[] {
  return diffWordsWithSpace(before, after).map((p) => ({
    text: p.value,
    kind: p.added ? "added" : p.removed ? "removed" : "equal",
  }));
}

/** The reply aligned to the draft, paragraph by paragraph, in document order. */
export function previewOps(draftPlain: string, proposed: string): PreviewOp[] {
  const before = splitParagraphs(draftPlain);
  const after = splitParagraphs(proposed);
  const groups = diffArrays(before.map(normalize), after.map(normalize));
  const ops: PreviewOp[] = [];
  let bi = 0;
  let ai = 0;
  for (let g = 0; g < groups.length; g++) {
    const part = groups[g]!;
    const count = part.count ?? part.value.length;
    if (!part.added && !part.removed) {
      for (let k = 0; k < count; k++) {
        ops.push({ kind: "equal", index: ops.length, before: before[bi]!, after: after[ai]! });
        bi++;
        ai++;
      }
      continue;
    }
    if (part.removed) {
      const removed = before.slice(bi, bi + count);
      bi += count;
      let added: string[] = [];
      const next = groups[g + 1];
      if (next?.added) {
        const n = next.count ?? next.value.length;
        added = after.slice(ai, ai + n);
        ai += n;
        g++;
      }
      let j = 0;
      for (const b of removed) {
        const candidate = added[j];
        if (candidate !== undefined && paragraphSimilarity(b, candidate) >= PAIR_THRESHOLD) {
          ops.push({ kind: "replace", index: ops.length, before: b, after: candidate, words: wordParts(b, candidate) });
          j++;
          continue;
        }
        ops.push({ kind: "delete", index: ops.length, before: b });
      }
      for (; j < added.length; j++) ops.push({ kind: "insert", index: ops.length, after: added[j]! });
      continue;
    }
    for (let k = 0; k < count; k++) ops.push({ kind: "insert", index: ops.length, after: after[ai++]! });
  }
  return ops;
}

export type PreviewSummary = {
  kept: number;
  inserted: number;
  deleted: number;
  replaced: number;
  /** inserted + deleted + replaced */
  changed: number;
  /** "3 paragraphs change · 1 kept" */
  label: string;
};

export function summarizePreview(ops: readonly PreviewOp[]): PreviewSummary {
  let kept = 0;
  let inserted = 0;
  let deleted = 0;
  let replaced = 0;
  for (const op of ops) {
    if (op.kind === "equal") kept++;
    else if (op.kind === "insert") inserted++;
    else if (op.kind === "delete") deleted++;
    else replaced++;
  }
  const changed = inserted + deleted + replaced;
  const label =
    changed === 0
      ? "no changes to the draft"
      : `${changed} paragraph${changed === 1 ? "" : "s"} change · ${kept} kept`;
  return { kept, inserted, deleted, replaced, changed, label };
}

/**
 * Whether a reply reads as a rewrite of the draft (it keeps or edits at
 * least one of its paragraphs) rather than an answer about it. With an
 * empty draft, any reply of forty words or more counts.
 */
export function looksLikeRewrite(ops: readonly PreviewOp[], draftEmpty: boolean): boolean {
  const s = summarizePreview(ops);
  if (s.changed === 0) return false;
  if (draftEmpty) {
    return ops.reduce((n, o) => n + (o.kind === "insert" ? countWords(o.after) : 0), 0) >= 40;
  }
  return s.kept + s.replaced >= 1;
}

/** Indexes of the ops that change the draft, in order. */
export function changedIndexes(ops: readonly PreviewOp[]): number[] {
  return ops.filter((o) => o.kind !== "equal").map((o) => o.index);
}

/**
 * The text to apply when only the ops in `taken` are accepted: every
 * other paragraph stays exactly as the draft has it, so the tracked
 * apply leaves those blocks untouched.
 */
export function composeSelection(ops: readonly PreviewOp[], taken: ReadonlySet<number>): string {
  const paras: string[] = [];
  for (const op of ops) {
    switch (op.kind) {
      case "equal":
        paras.push(op.before);
        break;
      case "insert":
        if (taken.has(op.index)) paras.push(op.after);
        break;
      case "delete":
        if (!taken.has(op.index)) paras.push(op.before);
        break;
      case "replace":
        paras.push(taken.has(op.index) ? op.after : op.before);
        break;
    }
  }
  return paras.join("\n\n");
}
