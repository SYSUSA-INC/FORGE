"use client";

import { useReducer, useEffect } from "react";
import type { Editor } from "@tiptap/core";
import { getPendingChanges, type PendingChange } from "./extensions/TrackChanges";

/**
 * BL-9 Slice 3 — sidebar panel for reviewing pending tracked changes.
 *
 * Shows each pending insertion / deletion with the author's name, a
 * preview of the affected text, and Accept / Reject buttons. Bulk
 * Accept-all / Reject-all are available when more than one change is
 * pending.
 *
 * Re-renders on every editor transaction so the list stays current.
 */

type Props = {
  editor: Editor | null;
  /** Show/hide the panel regardless of pending-change count. */
  visible: boolean;
};

export function TrackChangesSidebar({ editor, visible }: Props) {
  // Subscribe to editor transactions so the list stays live.
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!editor) return;
    editor.on("transaction", forceUpdate);
    return () => {
      editor.off("transaction", forceUpdate);
    };
  }, [editor]);

  if (!editor || !visible) return null;

  const changes = getPendingChanges(editor.state);
  const tcStorage = (editor.storage as unknown as Record<string, unknown>)
    .TrackChanges as { trackingEnabled: boolean } | undefined;
  const trackingEnabled: boolean = tcStorage?.trackingEnabled ?? false;

  function accept(id: string) {
    editor?.commands.acceptChange(id);
  }

  function reject(id: string) {
    editor?.commands.rejectChange(id);
  }

  function acceptAll() {
    editor?.commands.acceptAllChanges();
  }

  function rejectAll() {
    editor?.commands.rejectAllChanges();
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-white/10 bg-white/[0.02] p-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
            Track changes
          </span>
          <span
            className="rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider"
            style={
              trackingEnabled
                ? {
                    background: "rgba(251, 191, 36, 0.12)",
                    border: "1px solid rgba(251, 191, 36, 0.35)",
                    color: "#FBBF24",
                  }
                : {
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.10)",
                    color: "#6B7280",
                  }
            }
          >
            {trackingEnabled ? "recording" : "paused"}
          </span>
        </div>

        {changes.length > 1 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={acceptAll}
              className="rounded border border-emerald/30 bg-emerald/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald hover:bg-emerald/20 transition-colors"
            >
              Accept all
            </button>
            <button
              type="button"
              onClick={rejectAll}
              className="rounded border border-rose/30 bg-rose/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-rose hover:bg-rose/20 transition-colors"
            >
              Reject all
            </button>
          </div>
        )}
      </div>

      {/* Change list */}
      {changes.length === 0 ? (
        <p className="font-mono text-[11px] text-muted">
          {trackingEnabled
            ? "No pending changes — start editing to record suggestions."
            : "Turn on recording to track changes made by contributors."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {changes.map((c) => (
            <ChangeRow key={c.id} change={c} onAccept={accept} onReject={reject} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ChangeRow({
  change,
  onAccept,
  onReject,
}: {
  change: PendingChange;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const isInsert = change.type === "insert";
  const preview = change.text.slice(0, 80) + (change.text.length > 80 ? "…" : "");
  const timeAgo = formatTimeAgo(change.ts);

  return (
    <li className="flex flex-col gap-1 rounded border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="shrink-0 h-2 w-2 rounded-full"
            style={{ background: change.authorColor }}
          />
          <span className="truncate font-mono text-[10px] text-muted">
            {change.authorName || "Unknown"}
          </span>
          <span className="font-mono text-[10px] text-subtle">·</span>
          <span
            className="rounded px-1 py-0.5 font-mono text-[9px] uppercase tracking-wider"
            style={
              isInsert
                ? {
                    background: "rgba(74, 222, 128, 0.10)",
                    border: "1px solid rgba(74, 222, 128, 0.25)",
                    color: "#4ADE80",
                  }
                : {
                    background: "rgba(248, 113, 113, 0.10)",
                    border: "1px solid rgba(248, 113, 113, 0.25)",
                    color: "#F87171",
                  }
            }
          >
            {isInsert ? "+insert" : "−delete"}
          </span>
          <span className="font-mono text-[9px] text-subtle">{timeAgo}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onAccept(change.id)}
            title="Accept this change"
            className="rounded border border-emerald/30 bg-emerald/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald hover:bg-emerald/20 transition-colors"
          >
            ✓
          </button>
          <button
            type="button"
            onClick={() => onReject(change.id)}
            title="Reject this change"
            className="rounded border border-rose/30 bg-rose/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-rose hover:bg-rose/20 transition-colors"
          >
            ✕
          </button>
        </div>
      </div>
      {preview && (
        <p
          className="font-mono text-[10px] leading-relaxed"
          style={{ color: isInsert ? "#4ADE80" : "#F87171", opacity: 0.85 }}
        >
          {isInsert ? "+" : "−"} {preview}
        </p>
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
