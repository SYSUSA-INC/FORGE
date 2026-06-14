"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { backfillKnowledgeEntryQualityScoresAction } from "./actions";

/**
 * BL-10 Phase D-2 — small admin tool that scores entries which
 * predate the quality-scoring work (quality_scored_at IS NULL).
 * Sits next to the "Embed missing" button in the knowledge-base
 * header. Org-admin gated server-side. Idempotent — safe to
 * re-click; processes 100 at a time.
 */
export function RescoreEntriesButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setNotice(null);
    setError(null);
    startTransition(async () => {
      const res = await backfillKnowledgeEntryQualityScoresAction();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (res.processed === 0 && res.remaining === 0) {
        setNotice("Nothing to do — every entry is already scored.");
      } else {
        setNotice(
          `Scored ${res.processed} entries · ${res.remaining} remaining.`,
        );
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        title="Compute quality scores for any entries that don't have one yet. Safe to re-run; idempotent."
        className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-60"
      >
        {pending ? "Scoring…" : "Score unscored"}
      </button>
      {notice ? (
        <span className="font-mono text-[10px] text-emerald">{notice}</span>
      ) : null}
      {error ? (
        <span className="font-mono text-[10px] text-rose">{error}</span>
      ) : null}
    </div>
  );
}
