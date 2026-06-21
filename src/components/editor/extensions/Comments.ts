/**
 * BL-9 Slice 4 — Yjs-backed comment threads.
 *
 * Architecture:
 *   - A TipTap `commentAnchor` mark with attr `data-thread-id` covers the
 *     commented text; it's syncing inline with the Yjs document so all
 *     peers see the same highlight without extra plumbing.
 *   - Thread data lives on `ydoc.getMap("comments")` keyed by threadId.
 *     Each thread is itself a Y.Map with fields { id, createdAt,
 *     createdByUserId, createdByName, quoted, resolved } plus a
 *     `messages` Y.Array of Y.Map (id, authorId, authorName, body, ts).
 *   - Posting a reply or resolving updates the shared Y.Map → all peers
 *     see it immediately. Server persistence is the existing Hocuspocus
 *     `yjs_doc.state` row — no extra schema needed.
 *
 * Out of scope for this slice (future work):
 *   - Single-user (collab-off) persistence — comments only activate when
 *     a Y.Doc is supplied, which mirrors how collab is wired today.
 *   - Mentions / @-user notifications (BL-13 territory).
 *   - Y.RelativePosition orphan-resistance — when a remote edit deletes
 *     the commented text the mark goes with it; thread data persists
 *     in the Y.Map but becomes "orphaned" with no anchor. A future
 *     enhancement will store an absolute fallback so orphans render in
 *     a "no longer in document" bucket.
 */

import { Extension, Mark, mergeAttributes } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import type { Node as PmNode } from "@tiptap/pm/model";
import * as Y from "yjs";

// ────────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────────

export type CommentAuthor = {
  id: string;
  name: string;
};

export type CommentMessage = {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  ts: number;
};

export type CommentThread = {
  id: string;
  createdAt: number;
  createdByUserId: string;
  createdByName: string;
  quoted: string;
  resolved: boolean;
  messages: CommentMessage[];
  /** When true, no `commentAnchor` mark covers this thread in the doc. */
  orphaned: boolean;
  /** Position of the first anchor in the document, for sorting. */
  firstPos: number;
};

// ────────────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────────────

function makeId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Find all `commentAnchor` mark positions in the current document. */
function findAnchorPositions(
  state: EditorState,
): Map<string, { from: number; to: number }> {
  const map = new Map<string, { from: number; to: number }>();
  const anchorType = state.schema.marks.commentAnchor;
  if (!anchorType) return map;

  state.doc.descendants((node: PmNode, pos: number) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      if (mark.type !== anchorType) continue;
      const id = mark.attrs["data-thread-id"] as string | null;
      if (!id) continue;
      const existing = map.get(id);
      if (existing) {
        // Extend to cover later mark instances of the same thread.
        existing.to = pos + node.nodeSize;
      } else {
        map.set(id, { from: pos, to: pos + node.nodeSize });
      }
    }
  });

  return map;
}

/** Convert a Y.Map<unknown> representing a thread into a plain object. */
function readThread(ymap: Y.Map<unknown>): {
  id: string;
  createdAt: number;
  createdByUserId: string;
  createdByName: string;
  quoted: string;
  resolved: boolean;
  messages: CommentMessage[];
} | null {
  const id = ymap.get("id");
  if (typeof id !== "string") return null;
  const messagesRaw = ymap.get("messages");
  const messages: CommentMessage[] = [];
  if (messagesRaw instanceof Y.Array) {
    messagesRaw.forEach((m) => {
      if (m instanceof Y.Map) {
        const id = m.get("id");
        const authorId = m.get("authorId");
        const authorName = m.get("authorName");
        const body = m.get("body");
        const ts = m.get("ts");
        if (
          typeof id === "string" &&
          typeof authorId === "string" &&
          typeof authorName === "string" &&
          typeof body === "string" &&
          typeof ts === "number"
        ) {
          messages.push({ id, authorId, authorName, body, ts });
        }
      }
    });
  }
  return {
    id,
    createdAt: Number(ymap.get("createdAt")) || 0,
    createdByUserId: String(ymap.get("createdByUserId") ?? ""),
    createdByName: String(ymap.get("createdByName") ?? ""),
    quoted: String(ymap.get("quoted") ?? ""),
    resolved: Boolean(ymap.get("resolved") ?? false),
    messages,
  };
}

/**
 * Read every thread from the Y.Map and decorate with anchor positions
 * (or `orphaned: true` when no anchor remains).
 */
export function getCommentThreads(
  state: EditorState,
  ydoc: Y.Doc,
): CommentThread[] {
  const anchors = findAnchorPositions(state);
  const threadsMap = ydoc.getMap<Y.Map<unknown>>("comments");
  const out: CommentThread[] = [];

  threadsMap.forEach((ymap) => {
    const thread = readThread(ymap);
    if (!thread) return;
    const pos = anchors.get(thread.id);
    out.push({
      ...thread,
      orphaned: !pos,
      firstPos: pos?.from ?? Number.MAX_SAFE_INTEGER,
    });
  });

  // Sort: live threads by position, then orphaned threads by createdAt (newest).
  out.sort((a, b) => {
    if (a.orphaned !== b.orphaned) return a.orphaned ? 1 : -1;
    if (!a.orphaned && !b.orphaned) return a.firstPos - b.firstPos;
    return b.createdAt - a.createdAt;
  });

  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// CommentAnchor mark
// ────────────────────────────────────────────────────────────────────────────

export const CommentAnchor = Mark.create({
  name: "commentAnchor",
  // Allow stacking with TcInsert / TcDelete / other inline marks.
  priority: 999,
  inclusive: false,
  excludes: "",

  addAttributes() {
    return {
      "data-thread-id": { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-comment-anchor]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-comment-anchor": "",
        class: "comment-anchor",
      }),
      0,
    ];
  },
});

// ────────────────────────────────────────────────────────────────────────────
// Comments extension
// ────────────────────────────────────────────────────────────────────────────

type CommentsOptions = {
  /** Required — comments are a no-op without a Y.Doc. */
  ydoc: Y.Doc;
  author: CommentAuthor;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    Comments: {
      /** Create a new thread on the current selection. */
      addCommentThread: (initialMessage: string) => ReturnType;
      /** Post a reply to an existing thread. */
      replyToThread: (threadId: string, body: string) => ReturnType;
      /** Toggle a thread's resolved flag. */
      toggleThreadResolved: (threadId: string) => ReturnType;
      /** Focus the editor selection on a thread's anchor range. */
      focusThread: (threadId: string) => ReturnType;
    };
  }
}

export const Comments = Extension.create<CommentsOptions>({
  name: "Comments",

  addOptions() {
    return {
      ydoc: new Y.Doc(),
      author: { id: "", name: "" },
    };
  },

  addCommands() {
    return {
      addCommentThread:
        (initialMessage: string) =>
        ({ state, dispatch }) => {
          const ydoc = this.options.ydoc;
          const author = this.options.author;
          const { from, to } = state.selection;
          if (from === to) return false;
          const trimmed = (initialMessage || "").trim();
          if (!trimmed) return false;

          const threadId = makeId();
          const anchorType = state.schema.marks.commentAnchor;
          if (!anchorType) return false;

          const mark = anchorType.create({ "data-thread-id": threadId });
          const tr = state.tr.addMark(from, to, mark);
          // Don't lose the selection — keep it so the sidebar focus
          // function can re-target after the mark lands.
          if (dispatch) dispatch(tr);

          // Build the thread Y.Map.
          ydoc.transact(() => {
            const threads = ydoc.getMap<Y.Map<unknown>>("comments");
            const t = new Y.Map<unknown>();
            t.set("id", threadId);
            t.set("createdAt", Date.now());
            t.set("createdByUserId", author.id);
            t.set("createdByName", author.name);
            t.set(
              "quoted",
              state.doc.textBetween(from, to, " ").slice(0, 240),
            );
            t.set("resolved", false);
            const messages = new Y.Array<Y.Map<unknown>>();
            const firstMsg = new Y.Map<unknown>();
            firstMsg.set("id", makeId());
            firstMsg.set("authorId", author.id);
            firstMsg.set("authorName", author.name);
            firstMsg.set("body", trimmed);
            firstMsg.set("ts", Date.now());
            messages.push([firstMsg]);
            t.set("messages", messages);
            threads.set(threadId, t);
          });

          return true;
        },

      replyToThread:
        (threadId: string, body: string) =>
        () => {
          const ydoc = this.options.ydoc;
          const author = this.options.author;
          const trimmed = (body || "").trim();
          if (!trimmed) return false;

          const threads = ydoc.getMap<Y.Map<unknown>>("comments");
          const t = threads.get(threadId);
          if (!t) return false;
          ydoc.transact(() => {
            const messages = t.get("messages");
            if (!(messages instanceof Y.Array)) return;
            const m = new Y.Map<unknown>();
            m.set("id", makeId());
            m.set("authorId", author.id);
            m.set("authorName", author.name);
            m.set("body", trimmed);
            m.set("ts", Date.now());
            messages.push([m]);
          });
          return true;
        },

      toggleThreadResolved:
        (threadId: string) =>
        () => {
          const ydoc = this.options.ydoc;
          const threads = ydoc.getMap<Y.Map<unknown>>("comments");
          const t = threads.get(threadId);
          if (!t) return false;
          ydoc.transact(() => {
            t.set("resolved", !Boolean(t.get("resolved")));
          });
          return true;
        },

      focusThread:
        (threadId: string) =>
        ({ editor }) => {
          const anchors = findAnchorPositions(editor.state);
          const range = anchors.get(threadId);
          if (!range) return false;
          editor.commands.setTextSelection(range);
          editor.commands.focus();
          return true;
        },
    };
  },
});
