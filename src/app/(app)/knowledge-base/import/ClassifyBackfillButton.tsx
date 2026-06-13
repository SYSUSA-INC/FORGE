"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  runKnowledgeClassificationBackfillAction,
  type ClassifyBackfillResult,
} from "./actions";

export function ClassifyBackfillButton({
  candidateCount,
}: {
  candidateCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ClassifyBackfillResult | null>(null);

  function run() {
    setResult(null);
    startTransition(async () => {
      const res = await runKnowledgeClassificationBackfillAction();
      setResult(res);
      if (res.ok) router.refresh();
    });
  }

  if (candidateCount === 0 && !result) return null;

  return (
    <div className="rounded-md border border-violet/30 bg-violet/5 px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-violet">
            AI classification backfill
          </div>
          <div className="mt-1 font-mono text-[11px] text-text">
            {candidateCount} artifact{candidateCount === 1 ? "" : "s"} with{" "}
            <code>kind=&quot;other&quot;</code> and no AI suggestion yet.
            Processes up to 50 per click.
          </div>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={pending || candidateCount === 0}
          className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
        >
          {pending ? "Classifying…" : "Reclassify"}
        </button>
      </div>

      {result && result.ok ? (
        <div className="mt-2 rounded border border-emerald-500/30 bg-emerald-500/5 px-2 py-1 font-mono text-[10px] text-emerald-300">
          Processed {result.processed} · auto-applied {result.autoApplied} ·
          low-confidence suggestions {result.lowConfidence} · skipped{" "}
          {result.skipped}
        </div>
      ) : null}
      {result && !result.ok ? (
        <div className="mt-2 rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1 font-mono text-[10px] text-rose-300">
          {result.error}
        </div>
      ) : null}
    </div>
  );
}
