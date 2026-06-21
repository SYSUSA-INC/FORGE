/**
 * BL-9 Slice 3 — Y.Map-based track changes for the collaborative editor.
 *
 * Architecture:
 *   - Two TipTap marks (TcInsert / TcDelete) carry change metadata inline
 *     with the document. Yjs syncs them automatically to all peers.
 *   - A Y.Map("tc-meta") on the shared Y.Doc stores the tracking-mode toggle
 *     so all collaborators see when an owner turns tracking on or off.
 *   - Accept/reject commands manipulate marks + doc directly; no server
 *     round-trip is needed. Audit logging lands in Slice 7.
 *
 * Limitations in this slice (logged for future work):
 *   - Pasted text is not tracked (would require handlePaste override).
 *   - Cut is not tracked (requires handleDOMEvents: { cut }).
 *   - Block-level changes (paragraph splits, list structure) are not marked.
 *   - IME composition (CJK etc.) may bypass handleTextInput.
 */

import { Extension, Mark, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import type { Node as PmNode } from "@tiptap/pm/model";
import type * as Y from "yjs";

// ────────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────────

export type TrackAuthor = {
  id: string;
  name: string;
  color: string;
};

export type ChangeType = "insert" | "delete";

export type PendingChange = {
  id: string;
  type: ChangeType;
  authorId: string;
  authorName: string;
  authorColor: string;
  ts: number;
  /** Concatenated affected text — for display in the sidebar. */
  text: string;
};

// ────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────────

function makeChangeId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

type ChangeInfo = {
  id: string;
  type: ChangeType;
  authorId: string;
  authorName: string;
  authorColor: string;
  ts: number;
  ranges: Array<{ from: number; to: number }>;
};

/** Scan the document and group all tc marks by changeId. */
function collectChanges(state: EditorState): Map<string, ChangeInfo> {
  const map = new Map<string, ChangeInfo>();
  const { schema } = state;
  const insertType = schema.marks.tcInsert;
  const deleteType = schema.marks.tcDelete;
  if (!insertType || !deleteType) return map;

  state.doc.descendants((node: PmNode, pos: number) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      const id = mark.attrs["data-tc-id"] as string | null;
      if (!id) continue;

      let type: ChangeType | null = null;
      if (mark.type === insertType) type = "insert";
      else if (mark.type === deleteType) type = "delete";
      if (!type) continue;

      const existing = map.get(id);
      if (existing) {
        existing.ranges.push({ from: pos, to: pos + node.nodeSize });
      } else {
        map.set(id, {
          id,
          type,
          authorId: (mark.attrs["data-tc-author-id"] as string) || "",
          authorName: (mark.attrs["data-tc-author-name"] as string) || "",
          authorColor: (mark.attrs["data-tc-author-color"] as string) || "#888",
          ts: Number(mark.attrs["data-tc-ts"]) || 0,
          ranges: [{ from: pos, to: pos + node.nodeSize }],
        });
      }
    }
  });

  return map;
}

/** Derive pending changes as a sorted array (newest timestamp first). */
export function getPendingChanges(state: EditorState): PendingChange[] {
  const changes = collectChanges(state);
  return Array.from(changes.values())
    .map((info) => ({
      id: info.id,
      type: info.type,
      authorId: info.authorId,
      authorName: info.authorName,
      authorColor: info.authorColor,
      ts: info.ts,
      text: info.ranges
        .map((r) => state.doc.textBetween(r.from, r.to, " "))
        .join(" "),
    }))
    .sort((a, b) => b.ts - a.ts);
}

// ────────────────────────────────────────────────────────────────────────────
// TcInsert mark — green underline, text is the newly added content
// ────────────────────────────────────────────────────────────────────────────

export const TcInsert = Mark.create({
  name: "tcInsert",
  priority: 1001,
  inclusive: false,
  excludes: "",

  addAttributes() {
    return {
      "data-tc-id": { default: null },
      "data-tc-author-id": { default: null },
      "data-tc-author-name": { default: null },
      "data-tc-author-color": { default: "#4ADE80" },
      "data-tc-ts": { default: "0" },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-tc-insert]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-tc-insert": "",
        class: "tc-insert",
      }),
      0,
    ];
  },
});

// ────────────────────────────────────────────────────────────────────────────
// TcDelete mark — red strikethrough, text is preserved in the DOM
// ────────────────────────────────────────────────────────────────────────────

export const TcDelete = Mark.create({
  name: "tcDelete",
  priority: 1001,
  inclusive: false,
  excludes: "",

  addAttributes() {
    return {
      "data-tc-id": { default: null },
      "data-tc-author-id": { default: null },
      "data-tc-author-name": { default: null },
      "data-tc-author-color": { default: "#F87171" },
      "data-tc-ts": { default: "0" },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-tc-delete]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-tc-delete": "",
        class: "tc-delete",
      }),
      0,
    ];
  },
});

// ────────────────────────────────────────────────────────────────────────────
// ProseMirror plugin — intercepts local user input when tracking is on
// ────────────────────────────────────────────────────────────────────────────

const trackChangesPluginKey = new PluginKey<boolean>("trackChanges");

function buildPlugin(
  getTracking: () => boolean,
  getAuthor: () => TrackAuthor,
): Plugin {
  return new Plugin({
    key: trackChangesPluginKey,

    props: {
      /**
       * Backspace / Delete: mark text as deleted instead of removing it.
       * Both single-character and selection cases are handled.
       */
      handleKeyDown(view, event) {
        if (!getTracking()) return false;

        const { state } = view;
        const { selection } = state;
        const { from, to, empty } = selection;

        const author = getAuthor();
        const changeId = makeChangeId();
        const deleteAttrs = {
          "data-tc-id": changeId,
          "data-tc-author-id": author.id,
          "data-tc-author-name": author.name,
          "data-tc-author-color": author.color,
          "data-tc-ts": String(Date.now()),
        };
        const deleteMark = state.schema.marks.tcDelete?.create(deleteAttrs);
        if (!deleteMark) return false;

        // Non-empty selection + Backspace or Delete.
        if (!empty && (event.key === "Backspace" || event.key === "Delete")) {
          const tr = state.tr.addMark(from, to, deleteMark);
          tr.setSelection(TextSelection.create(tr.doc, to));
          view.dispatch(tr);
          return true;
        }

        // Single-char Backspace.
        if (empty && event.key === "Backspace" && from > 1) {
          const $from = state.doc.resolve(from);
          const backFrom = Math.max($from.start(), from - 1);
          if (backFrom >= from) return false;
          const tr = state.tr.addMark(backFrom, from, deleteMark);
          tr.setSelection(TextSelection.create(tr.doc, backFrom));
          view.dispatch(tr);
          return true;
        }

        // Single-char Delete (forward).
        if (empty && event.key === "Delete") {
          const $from = state.doc.resolve(from);
          if (from >= $from.end()) return false;
          const tr = state.tr.addMark(from, from + 1, deleteMark);
          view.dispatch(tr);
          return true;
        }

        return false;
      },

      /**
       * Text input: insert with tcInsert mark. If a selection is being
       * replaced, the selected text gets tcDelete mark instead of being
       * removed.
       */
      handleTextInput(view, from, to, text) {
        if (!getTracking()) return false;

        const { state } = view;
        const author = getAuthor();
        const ts = String(Date.now());

        const insertMark = state.schema.marks.tcInsert?.create({
          "data-tc-id": makeChangeId(),
          "data-tc-author-id": author.id,
          "data-tc-author-name": author.name,
          "data-tc-author-color": author.color,
          "data-tc-ts": ts,
        });
        if (!insertMark) return false;

        const tr = state.tr;

        // Insert the typed text before the selected range (if any).
        tr.insertText(text, from);

        // Mark inserted text as tcInsert.
        tr.addMark(from, from + text.length, insertMark);

        // If there was a selection, the original text has shifted right by
        // text.length. Mark it as a tracked deletion.
        if (from !== to) {
          const deleteMark = state.schema.marks.tcDelete?.create({
            "data-tc-id": makeChangeId(),
            "data-tc-author-id": author.id,
            "data-tc-author-name": author.name,
            "data-tc-author-color": author.color,
            "data-tc-ts": ts,
          });
          if (deleteMark) {
            tr.addMark(from + text.length, to + text.length, deleteMark);
          }
        }

        // Place cursor after inserted text.
        tr.setSelection(TextSelection.create(tr.doc, from + text.length));
        view.dispatch(tr);
        return true;
      },
    },
  });
}

// ────────────────────────────────────────────────────────────────────────────
// TrackChanges extension
// ────────────────────────────────────────────────────────────────────────────

type TrackChangesOptions = {
  authorId: string;
  authorName: string;
  authorColor: string;
  /** When provided, tracking-mode toggle syncs via ydoc.getMap("tc-meta"). */
  ydoc?: Y.Doc;
};

type TrackChangesStorage = {
  trackingEnabled: boolean;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    TrackChanges: {
      /** Turn tracking mode on or off. Syncs to all collab peers when ydoc is set. */
      setTrackingMode: (enabled: boolean) => ReturnType;
      /** Accept a specific change by its changeId. */
      acceptChange: (id: string) => ReturnType;
      /** Reject a specific change by its changeId. */
      rejectChange: (id: string) => ReturnType;
      /** Accept every pending change in one transaction. */
      acceptAllChanges: () => ReturnType;
      /** Reject every pending change in one transaction. */
      rejectAllChanges: () => ReturnType;
    };
  }
}

export const TrackChanges = Extension.create<
  TrackChangesOptions,
  TrackChangesStorage
>({
  name: "TrackChanges",

  addOptions() {
    return {
      authorId: "",
      authorName: "",
      authorColor: "#888",
      ydoc: undefined,
    };
  },

  addStorage() {
    return { trackingEnabled: false };
  },

  onCreate() {
    const ydoc = this.options.ydoc;
    if (!ydoc) return;

    const meta = ydoc.getMap<boolean>("tc-meta");
    const current = meta.get("trackingEnabled");
    if (typeof current === "boolean") {
      this.storage.trackingEnabled = current;
    }

    // Keep local storage in sync when a remote peer toggles tracking.
    meta.observe(() => {
      const v = meta.get("trackingEnabled");
      if (typeof v === "boolean" && this.storage.trackingEnabled !== v) {
        this.storage.trackingEnabled = v;
        this.editor.view.dispatch(
          this.editor.state.tr.setMeta("tc-sync", v),
        );
      }
    });
  },

  addCommands() {
    return {
      setTrackingMode:
        (enabled) =>
        ({ editor }) => {
          this.storage.trackingEnabled = enabled;
          const ydoc = this.options.ydoc;
          if (ydoc) ydoc.getMap<boolean>("tc-meta").set("trackingEnabled", enabled);
          // Force a transaction so plugins re-read the tracking state.
          editor.view.dispatch(editor.state.tr.setMeta("tc-toggle", enabled));
          return true;
        },

      acceptChange:
        (id) =>
        ({ state, dispatch }) => {
          const changes = collectChanges(state);
          const change = changes.get(id);
          if (!change || !dispatch) return false;

          const { schema } = state;
          const tr = state.tr;

          if (change.type === "insert") {
            const insertType = schema.marks.tcInsert;
            if (!insertType) return false;
            for (const { from, to } of change.ranges) {
              tr.removeMark(from, to, insertType);
            }
          } else {
            // Delete ranges in descending position order so position
            // offsets from earlier deletions don't invalidate later ones.
            const sorted = [...change.ranges].sort((a, b) => b.from - a.from);
            for (const { from, to } of sorted) {
              tr.delete(from, to);
            }
          }

          dispatch(tr);
          return true;
        },

      rejectChange:
        (id) =>
        ({ state, dispatch }) => {
          const changes = collectChanges(state);
          const change = changes.get(id);
          if (!change || !dispatch) return false;

          const { schema } = state;
          const tr = state.tr;

          if (change.type === "insert") {
            // Reject insertion: remove the text (descending order).
            const sorted = [...change.ranges].sort((a, b) => b.from - a.from);
            for (const { from, to } of sorted) {
              tr.delete(from, to);
            }
          } else {
            // Reject deletion: keep the text, remove the visual mark.
            const deleteType = schema.marks.tcDelete;
            if (!deleteType) return false;
            for (const { from, to } of change.ranges) {
              tr.removeMark(from, to, deleteType);
            }
          }

          dispatch(tr);
          return true;
        },

      acceptAllChanges:
        () =>
        ({ state, dispatch }) => {
          const changes = collectChanges(state);
          if (changes.size === 0 || !dispatch) return false;

          const { schema } = state;
          const tr = state.tr;

          const insertRanges: Array<{ from: number; to: number }> = [];
          const deleteRanges: Array<{ from: number; to: number }> = [];

          for (const change of changes.values()) {
            if (change.type === "insert") insertRanges.push(...change.ranges);
            else deleteRanges.push(...change.ranges);
          }

          // Remove tcInsert marks (no structural change — order doesn't matter).
          const insertType = schema.marks.tcInsert;
          if (insertType) {
            for (const { from, to } of insertRanges) {
              tr.removeMark(from, to, insertType);
            }
          }

          // Delete tcDelete text in descending position order.
          const sortedDel = deleteRanges.sort((a, b) => b.from - a.from);
          for (const { from, to } of sortedDel) {
            tr.delete(from, to);
          }

          dispatch(tr);
          return true;
        },

      rejectAllChanges:
        () =>
        ({ state, dispatch }) => {
          const changes = collectChanges(state);
          if (changes.size === 0 || !dispatch) return false;

          const { schema } = state;
          const tr = state.tr;

          const insertRanges: Array<{ from: number; to: number }> = [];
          const deleteRanges: Array<{ from: number; to: number }> = [];

          for (const change of changes.values()) {
            if (change.type === "insert") insertRanges.push(...change.ranges);
            else deleteRanges.push(...change.ranges);
          }

          // Remove tcDelete marks (keep the text — no structural change).
          const deleteType = schema.marks.tcDelete;
          if (deleteType) {
            for (const { from, to } of deleteRanges) {
              tr.removeMark(from, to, deleteType);
            }
          }

          // Delete tcInsert text in descending position order.
          const sortedIns = insertRanges.sort((a, b) => b.from - a.from);
          for (const { from, to } of sortedIns) {
            tr.delete(from, to);
          }

          dispatch(tr);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const getTracking = () => this.storage.trackingEnabled;
    const getAuthor = (): TrackAuthor => ({
      id: this.options.authorId,
      name: this.options.authorName,
      color: this.options.authorColor,
    });
    return [buildPlugin(getTracking, getAuthor)];
  },
});
