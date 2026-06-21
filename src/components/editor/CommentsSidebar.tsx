"use client";

import { useEffect, useReducer, useState } from "react";
import type { Editor } from "@tiptap/core";
import type * as Y from "yjs";
import { getCommentThreads, type CommentThread } from "./extensions/Comments";

/**
 * BL-9 Slice 4 — sidebar panel for browsing comment threads.
 *
 * Subscribes to the Y.Doc's `comments` Y.Map so every remote update
 * (new thread, reply, resolve) reaches the panel without a refresh.
 * Also subscribes to editor transactions so anchor positions stay in
 * sync when the document is edited.
 */

type Props = {
  editor: Editor | null;
  ydoc: Y.Doc | null;
  visible: boolean;
  /** Current viewer — for matching "your reply" UI affordances. */
  currentUserId: string;
};

export function CommentsSidebar({ editor, ydoc, visible, currentUserId }: Props) {
  const [showResolved, setShowResolved] = useState(false);
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  // Subscribe to Y.Map changes (deep observer covers nested message arrays).
  useEffect(() => {
    if (!ydoc) return;
    const threads = ydoc.getMap("comments");
    threads.observeDeep(forceUpdate);
    return () => {
      threads.unobserveDeep(forceUpdate);
    };
  }, [ydoc]);

  // Subscribe to editor transactions so anchor positions stay current.
  useEffect(() => {
    if (!editor) return;
    editor.on("transaction", forceUpdate);
    return () => {
      editor.off("transaction", forceUpdate);
    };
  }, [editor]);

  if (!visible || !editor || !ydoc) return null;

  const threads = getCommentThreads(editor.state, ydoc);
  const visibleThreads = showResolved
    ? threads
    : threads.filter((t) => !t.resolved);
  const resolvedCount = threads.filter((t) => t.resolved).length;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
          Comments {threads.length > 0 ? `· ${threads.length}` : ""}
        </span>
        {resolvedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowResolved((v) => !v)}
            className="rounded border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted hover:bg-white/10 transition-colors"
          >
            {showResolved
              ? `Hide ${resolvedCount} resolved`
              : `Show ${resolvedCount} resolved`}
          </button>
        )}
      </div>

      {visibleThreads.length === 0 ? (
        <p className="font-mono text-[11px] text-muted">
          {threads.length === 0
            ? "Select text and click \"comment\" in the toolbar to start a thread."
            : "All threads resolved."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visibleThreads.map((t) => (
            <ThreadCard
              key={t.id}
              thread={t}
              editor={editor}
              currentUserId={currentUserId}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ThreadCard({
  thread,
  editor,
  currentUserId,
}: {
  thread: CommentThread;
  editor: Editor;
  currentUserId: string;
}) {
  const [reply, setReply] = useState("");

  function submitReply() {
    const body = reply.trim();
    if (!body) return;
    editor.commands.replyToThread(thread.id, body);
    setReply("");
  }

  function toggleResolved() {
    editor.commands.toggleThreadResolved(thread.id);
  }

  function focusInDoc() {
    editor.commands.focusThread(thread.id);
  }

  return (
    <li
      className={`flex flex-col gap-1.5 rounded border px-2.5 py-2 ${
        thread.resolved
          ? "border-white/[0.06] bg-white/[0.02] opacity-70"
          : "border-white/[0.08] bg-white/[0.04]"
      }`}
    >
      {/* Header: opener + status + orphan flag */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate font-mono text-[10px] text-muted">
            {thread.createdByName || "Unknown"}
          </span>
          <span className="font-mono text-[10px] text-subtle">·</span>
          <span className="font-mono text-[9px] text-subtle">
            {formatTimeAgo(thread.createdAt)}
          </span>
          {thread.resolved && (
            <span className="ml-1 rounded border border-emerald/30 bg-emerald/10 px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald">
              resolved
            </span>
          )}
          {thread.orphaned && (
            <span
              className="ml-1 rounded px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider"
              style={{
                background: "rgba(251, 191, 36, 0.10)",
                border: "1px solid rgba(251, 191, 36, 0.30)",
                color: "#FBBF24",
              }}
              title="The text this thread was attached to has been deleted."
            >
              orphaned
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!thread.orphaned && (
            <button
              type="button"
              onClick={focusInDoc}
              title="Find this comment's text in the editor"
              className="rounded px-1.5 py-0.5 font-mono text-[9px] text-muted hover:bg-white/[0.08] hover:text-text transition-colors"
            >
              jump
            </button>
          )}
          <button
            type="button"
            onClick={toggleResolved}
            title={thread.resolved ? "Re-open this thread" : "Mark resolved"}
            className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider transition-colors ${
              thread.resolved
                ? "border-white/15 bg-white/[0.04] text-muted hover:bg-white/10"
                : "border-emerald/30 bg-emerald/10 text-emerald hover:bg-emerald/20"
            }`}
          >
            {thread.resolved ? "Reopen" : "Resolve"}
          </button>
        </div>
      </div>

      {/* Quoted snippet */}
      {thread.quoted && (
        <blockquote
          className="border-l-2 border-yellow-400/40 pl-2 font-mono text-[10px] italic"
          style={{ color: "#D6CFA9" }}
        >
          &ldquo;{thread.quoted}&rdquo;
        </blockquote>
      )}

      {/* Messages */}
      <div className="flex flex-col gap-1.5">
        {thread.messages.map((m) => (
          <div
            key={m.id}
            className="rounded bg-white/[0.03] px-2 py-1.5 font-mono text-[11px] leading-relaxed text-text"
          >
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted">
                {m.authorName}
                {m.authorId === currentUserId ? " (you)" : ""}
              </span>
              <span className="text-[9px] text-subtle">
                · {formatTimeAgo(m.ts)}
              </span>
            </div>
            <p className="mt-0.5 whitespace-pre-wrap text-text">{m.body}</p>
          </div>
        ))}
      </div>

      {/* Reply box — hidden when resolved (re-open first) */}
      {!thread.resolved && (
        <div className="flex items-end gap-1.5">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submitReply();
              }
            }}
            rows={2}
            placeholder="Reply (⌘+Enter to send)"
            className="aur-input flex-1 resize-none text-[11px]"
          />
          <button
            type="button"
            onClick={submitReply}
            disabled={!reply.trim()}
            className="aur-btn-primary text-[10px] disabled:opacity-40"
          >
            Reply
          </button>
        </div>
      )}
    </li>
  );
}

function formatTimeAgo(tsMs: number): string {
  const diff = Date.now() - tsMs;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
