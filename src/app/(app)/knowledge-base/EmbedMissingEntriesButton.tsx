"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { backfillKnowledgeEntryEmbeddingsAction } from "./actions";

/**
 * Small admin tool that calls the backfill action exposed in 10f.
 * Lives in the knowledge-base header so org admins can flip the
 * Brain to use real cosine similarity (vs token overlap) for any
 * curated entries that predate the embeddings work.
 */
export function EmbedMissingEntriesButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setNotice(null);
    setError(null);
    startTransition(async () => {
      const res = await backfillKnowledgeEntryEmbeddingsAction();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const total = res.embedded + res.skipped;
      if (total === 0) {
        setNotice("Nothing to do — every entry is already embedded.");
      } else {
        setNotice(
          `Embedded ${res.embedded}${
            res.skipped > 0 ? `, skipped ${res.skipped}` : ""
          }.`,
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
        title="Embed any curated entries that don't yet have a vector. Safe to re-run; idempotent. Needs OPENAI_API_KEY for live embeddings."
        className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-60"
      >
        {pending ? "Embedding…" : "Embed missing"}
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
