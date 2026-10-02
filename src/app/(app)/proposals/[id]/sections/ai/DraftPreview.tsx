"use client";

import { useMemo, useState } from "react";
import {
  changedIndexes,
  composeSelection,
  previewOps,
  summarizePreview,
  type PreviewOp,
} from "@/lib/draft-preview";

/**
 * BL-FB-CHAT-SIDEBYSIDE — the chat's reply shown as edits to the draft,
 * paragraph by paragraph, in the right pane. Updates as the reply
 * streams; the author unticks paragraphs they do not want and applies
 * the rest as tracked changes by FORGE AI.
 */
export function DraftPreview({
  draft,
  proposed,
  streaming,
  onApply,
  onBack,
}: {
  /** The section as plain text, as it stands in the editor. */
  draft: string;
  /** The reply, complete or streaming. */
  proposed: string;
  streaming: boolean;
  /** Apply the composed text as tracked changes. */
  onApply: (text: string) => void;
  onBack: () => void;
}) {
  const ops = useMemo(() => previewOps(draft, proposed), [draft, proposed]);
  const summary = summarizePreview(ops);
  const changed = changedIndexes(ops);
  const [skipped, setSkipped] = useState<Set<number>>(() => new Set());
  const taken = new Set(changed.filter((i) => !skipped.has(i)));
  function toggle(i: number) {
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-indigo-400/30 bg-indigo-400/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-indigo-300">
          Edits preview · {summary.label}
          {streaming ? " · streaming…" : ""}
        </span>
        <button
          type="button"
          onClick={onBack}
          className="font-mono text-[10px] uppercase tracking-widest text-muted hover:text-text"
        >
          Back to draft
        </button>
      </div>
      {ops.length === 0 ? (
        <p className="font-body text-[11px] text-muted">Waiting for the reply…</p>
      ) : (
        <ol className="flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto">
          {ops.map((op) => (
            <PreviewRow
              key={op.index}
              op={op}
              taken={taken.has(op.index)}
              disabled={streaming}
              onToggle={() => toggle(op.index)}
            />
          ))}
        </ol>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className="font-body text-[11px] text-muted">
          Ticked paragraphs land as tracked changes by FORGE AI; accept or reject each change in Track changes, then save.
        </span>
        <button
          type="button"
          className="aur-btn aur-btn-primary shrink-0 text-[11px] disabled:opacity-50"
          disabled={streaming || taken.size === 0}
          onClick={() => onApply(composeSelection(ops, taken))}
        >
          Apply {taken.size} of {changed.length} as tracked changes
        </button>
      </div>
    </div>
  );
}

function PreviewRow({
  op,
  taken,
  disabled,
  onToggle,
}: {
  op: PreviewOp;
  taken: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  if (op.kind === "equal") {
    return (
      <li className="flex items-baseline gap-2 rounded border border-layer/10 px-2 py-1 font-body text-[11px] text-muted">
        <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider">kept</span>
        <span className="line-clamp-1 min-w-0">{op.before}</span>
      </li>
    );
  }
  const frame =
    op.kind === "insert"
      ? "border-emerald-400/30 bg-emerald-400/5"
      : op.kind === "delete"
        ? "border-rose-400/30 bg-rose-400/5"
        : "border-amber-400/30 bg-amber-400/5";
  const label = op.kind === "insert" ? "new paragraph" : op.kind === "delete" ? "removed" : "edited";
  return (
    <li className={`rounded border px-2 py-1.5 ${frame} ${taken ? "" : "opacity-50"}`}>
      <label className="flex cursor-pointer items-start gap-2">
        <input type="checkbox" checked={taken} disabled={disabled} onChange={onToggle} className="mt-1 accent-teal" />
        <span className="min-w-0 flex-1">
          <span className="font-mono text-[9px] uppercase tracking-wider text-muted">{label}</span>
          <span className="block whitespace-pre-wrap font-body text-[12px] leading-relaxed text-text">
            {op.kind === "insert" ? (
              <ins className="text-emerald-300 no-underline">{op.after}</ins>
            ) : op.kind === "delete" ? (
              <del className="text-rose-300">{op.before}</del>
            ) : (
              op.words.map((w, i) =>
                w.kind === "equal" ? (
                  <span key={i}>{w.text}</span>
                ) : w.kind === "added" ? (
                  <ins key={i} className="rounded bg-emerald-400/15 text-emerald-200 no-underline">
                    {w.text}
                  </ins>
                ) : (
                  <del key={i} className="rounded bg-rose-400/15 text-rose-300">
                    {w.text}
                  </del>
                ),
              )
            )}
          </span>
        </span>
      </label>
    </li>
  );
}
