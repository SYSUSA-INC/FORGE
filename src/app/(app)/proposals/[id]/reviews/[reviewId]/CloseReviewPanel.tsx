"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import type { ReviewVerdict } from "@/db/schema";
import { VERDICT_LABELS } from "@/lib/review-types";
import { cancelReviewAction, closeReviewAction } from "../actions";

export function CloseReviewPanel({
  reviewId,
  overallVerdict,
  initialSummary,
}: {
  reviewId: string;
  overallVerdict: ReviewVerdict | null;
  initialSummary: string;
}) {
  const router = useRouter();
  const [verdict, setVerdict] = useState<ReviewVerdict>(
    overallVerdict ?? "conditional",
  );
  const [summary, setSummary] = useState(initialSummary);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClose(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await closeReviewAction({ reviewId, verdict, summary });
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  function onCancel() {
    if (!window.confirm("Cancel this review? It will be archived.")) return;
    setError(null);
    startTransition(async () => {
      const res = await cancelReviewAction(reviewId);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  return (
    <Panel title="Close review" eyebrow="Record final verdict">
      <form className="flex flex-col gap-3" onSubmit={onClose}>
        <div>
          <label className="aur-label">Final verdict</label>
          <select
            className="aur-input"
            value={verdict}
            onChange={(e) => setVerdict(e.target.value as ReviewVerdict)}
          >
            <option value="pass">{VERDICT_LABELS.pass}</option>
            <option value="conditional">{VERDICT_LABELS.conditional}</option>
            <option value="fail">{VERDICT_LABELS.fail}</option>
          </select>
          {overallVerdict ? (
            <div className="mt-1 font-mono text-[10px] text-muted">
              Reviewers suggest: {VERDICT_LABELS[overallVerdict]}
            </div>
          ) : null}
        </div>
        <div>
          <label className="aur-label">Summary</label>
          <textarea
            className="aur-input min-h-[100px] resize-y"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Outcome, key issues, actions required."
          />
        </div>
        {error ? (
          <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
            {error}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={pending}
            className="aur-btn aur-btn-primary py-2.5 text-sm disabled:opacity-60"
          >
            {pending ? "Closing…" : "Close review"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onCancel}
            className="aur-btn aur-btn-danger py-2.5 text-sm disabled:opacity-60"
          >
            Cancel review
          </button>
        </div>
      </form>
    </Panel>
  );
}
