"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  acknowledgeErrorAction,
  resolveErrorAction,
  unresolveErrorAction,
  updateErrorNotesAction,
} from "./actions";

export function ErrorRowActions({
  id,
  acknowledged,
  resolved,
  acknowledgedBy,
  notes,
}: {
  id: string;
  acknowledged: boolean;
  resolved: boolean;
  acknowledgedBy: string;
  notes: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingNotes, setEditingNotes] = useState(false);
  const [draftNotes, setDraftNotes] = useState(notes);
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function saveNotes() {
    run(() => updateErrorNotesAction(id, draftNotes));
    setEditingNotes(false);
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px]">
        <div className="text-muted">
          {resolved
            ? "✅ Resolved"
            : acknowledged
              ? `👁 Acknowledged${acknowledgedBy ? ` by ${acknowledgedBy}` : ""}`
              : "⚠ New / unacknowledged"}
        </div>
        <div className="flex flex-wrap gap-2">
          {!acknowledged && !resolved ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => acknowledgeErrorAction(id))}
              className="aur-btn aur-btn-ghost text-[11px]"
            >
              Acknowledge
            </button>
          ) : null}
          {!resolved ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => resolveErrorAction(id))}
              className="aur-btn aur-btn-primary text-[11px]"
            >
              Mark resolved
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => unresolveErrorAction(id))}
              className="aur-btn aur-btn-ghost text-[11px]"
            >
              Re-open
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setEditingNotes((v) => !v);
              if (!editingNotes) setDraftNotes(notes);
            }}
            className="aur-btn aur-btn-ghost text-[11px]"
          >
            {editingNotes ? "Cancel notes" : notes ? "Edit notes" : "Add notes"}
          </button>
        </div>
      </div>

      {!editingNotes && notes ? (
        <p className="rounded-md border border-white/5 bg-white/[0.02] px-3 py-2 font-mono text-[11px] leading-relaxed text-muted">
          {notes}
        </p>
      ) : null}

      {editingNotes ? (
        <div className="flex flex-col gap-2">
          <textarea
            rows={3}
            value={draftNotes}
            onChange={(e) => setDraftNotes(e.target.value)}
            className="aur-input min-h-[80px] font-mono text-[11px]"
            placeholder="Triage notes — what's the suspected cause, who's investigating, etc."
            maxLength={4000}
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => setEditingNotes(false)}
              className="aur-btn aur-btn-ghost text-[11px]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={saveNotes}
              className="aur-btn aur-btn-primary text-[11px]"
            >
              {pending ? "Saving…" : "Save notes"}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
    </div>
  );
}
