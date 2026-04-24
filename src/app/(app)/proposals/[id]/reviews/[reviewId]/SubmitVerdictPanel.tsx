"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import type { ReviewVerdict } from "@/db/schema";
import { VERDICT_LABELS } from "@/lib/review-types";
import { submitReviewerVerdictAction } from "../actions";

export function SubmitVerdictPanel({
  reviewId,
  initialVerdict,
  initialSummary,
  alreadySubmitted,
}: {
  reviewId: string;
  initialVerdict: ReviewVerdict | null;
  initialSummary: string;
  alreadySubmitted: boolean;
}) {
  const router = useRouter();
  const [verdict, setVerdict] = useState<ReviewVerdict>(
    initialVerdict ?? "pass",
  );
  const [summary, setSummary] = useState(initialSummary);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await submitReviewerVerdictAction({
        reviewId,
        verdict,
        summary,
      });
      if (!res.ok) return setError(res.error);
      setNotice(alreadySubmitted ? "Verdict updated." : "Verdict submitted.");
      router.refresh();
    });
  }

  return (
    <Panel
      title={alreadySubmitted ? "Update your verdict" : "Submit your verdict"}
      eyebrow="Your review"
    >
      <form className="flex flex-col gap-3" onSubmit={onSubmit}>
        <div>
          <label className="aur-label">Verdict</label>
          <select
            className="aur-input"
            value={verdict}
            onChange={(e) => setVerdict(e.target.value as ReviewVerdict)}
          >
            <option value="pass">{VERDICT_LABELS.pass}</option>
            <option value="conditional">{VERDICT_LABELS.conditional}</option>
            <option value="fail">{VERDICT_LABELS.fail}</option>
          </select>
        </div>
        <div>
          <label className="aur-label">Summary</label>
          <textarea
            className="aur-input min-h-[100px] resize-y"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Top strengths, weaknesses, and recommended next steps."
          />
        </div>
        {error ? (
          <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald">
            {notice}
          </div>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="aur-btn aur-btn-primary py-2.5 text-sm disabled:opacity-60"
        >
          {pending ? "Submitting…" : alreadySubmitted ? "Update" : "Submit"}
        </button>
      </form>
    </Panel>
  );
}
