"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import type { ReviewChecklistItem } from "@/db/schema";
import { checklistProgress, type ChecklistState } from "@/lib/review-workflow-logic";
import { setChecklistItemAction } from "../actions";

type Reviewer = { userId: string; name: string | null; email: string };

/**
 * BL-FB-X-COLOR-TEAM — the round's checklist. An assigned reviewer
 * ticks their own copy and can leave a note per line; everyone sees how
 * far each reviewer is.
 */
export function ChecklistPanel({
  reviewId,
  items,
  states,
  reviewers,
  currentUserId,
  canTick,
}: {
  reviewId: string;
  items: ReviewChecklistItem[];
  states: (ChecklistState & { note: string })[];
  reviewers: Reviewer[];
  currentUserId: string;
  canTick: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  if (items.length === 0) return null;

  const progress = checklistProgress(items, states, reviewers.map((r) => r.userId));
  const mine = new Map(states.filter((s) => s.userId === currentUserId).map((s) => [s.itemKey, s] as const));
  const myProgress = progress.perReviewer.find((p) => p.userId === currentUserId);

  function save(itemKey: string, checked: boolean, note?: string) {
    setError(null);
    startTransition(async () => {
      const res = await setChecklistItemAction({ reviewId, itemKey, checked, note: note ?? mine.get(itemKey)?.note ?? "" });
      if (!res.ok) return setError(res.error);
      setNoteFor(null);
      router.refresh();
    });
  }

  return (
    <Panel
      title="Reviewer checklist"
      eyebrow={canTick && myProgress ? `You: ${myProgress.done}/${myProgress.total} · all: ${progress.done}/${progress.of}` : `${progress.done}/${progress.of} ticks across reviewers`}
    >
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => {
          const state = mine.get(item.key);
          const others = reviewers.filter((r) => r.userId !== currentUserId && states.some((s) => s.userId === r.userId && s.itemKey === item.key && s.checked)).length;
          return (
            <li key={item.key} className="rounded-md border border-layer/10 bg-layer/[0.02] px-3 py-2">
              <label className={`flex items-start gap-2 ${canTick ? "cursor-pointer" : ""}`}>
                <input
                  type="checkbox"
                  className="mt-0.5 accent-teal-400 disabled:opacity-50"
                  checked={state?.checked ?? false}
                  disabled={!canTick || pending}
                  onChange={(e) => save(item.key, e.target.checked)}
                />
                <span className="min-w-0 flex-1">
                  <span className={`block font-body text-[12px] ${state?.checked ? "text-muted line-through" : "text-text"}`}>{item.label}</span>
                  {item.hint ? <span className="block font-body text-[11px] text-subtle">{item.hint}</span> : null}
                  {state?.note && noteFor !== item.key ? <span className="mt-1 block whitespace-pre-wrap font-mono text-[11px] text-muted">{state.note}</span> : null}
                </span>
                <span className="shrink-0 font-mono text-[9px] uppercase tracking-widest text-subtle" title="Other reviewers who ticked this">
                  {others > 0 ? `+${others}` : ""}
                </span>
              </label>
              {canTick ? (
                noteFor === item.key ? (
                  <div className="mt-2 flex gap-2">
                    <input
                      className="aur-input flex-1 text-[11px]"
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder="A note for the writers (optional)"
                      maxLength={500}
                      autoFocus
                    />
                    <button type="button" className="aur-btn aur-btn-ghost text-[11px]" disabled={pending} onClick={() => save(item.key, state?.checked ?? false, noteDraft)}>
                      Save
                    </button>
                    <button type="button" className="aur-btn aur-btn-ghost text-[11px]" onClick={() => setNoteFor(null)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="mt-1 font-mono text-[9px] uppercase tracking-widest text-subtle hover:text-text"
                    onClick={() => {
                      setNoteFor(item.key);
                      setNoteDraft(state?.note ?? "");
                    }}
                  >
                    {state?.note ? "Edit note" : "Add note"}
                  </button>
                )
              ) : null}
            </li>
          );
        })}
      </ul>
      {reviewers.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {progress.perReviewer.map((p) => {
            const r = reviewers.find((x) => x.userId === p.userId);
            const full = p.total > 0 && p.done === p.total;
            return (
              <span key={p.userId} className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${full ? "bg-emerald/10 text-emerald" : "bg-layer/5 text-muted"}`}>
                {(r?.name ?? r?.email) || "?"} · {p.done}/{p.total}
              </span>
            );
          })}
        </div>
      ) : null}
      {error ? <div className="mt-2 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">{error}</div> : null}
    </Panel>
  );
}
