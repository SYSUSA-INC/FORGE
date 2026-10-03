"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { StubModeBanner } from "@/components/ui/StubModeBanner";
import type { ReviewAiSummary } from "@/db/schema";
import { summaryMarkdown } from "@/lib/review-workflow-logic";
import { summarizeReviewAction } from "../actions";

/**
 * BL-FB-X-COLOR-TEAM Slice 2 — the debrief of the round: themes across
 * reviewers, what must be fixed, what to keep, what the lead does next.
 * Generated on demand, stored on the round, copied as Markdown.
 */
export function ReviewSummaryPanel({ reviewId, summary, summaryAt }: { reviewId: string; summary: ReviewAiSummary | null; summaryAt: string | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [stubbed, setStubbed] = useState(false);
  const [copied, setCopied] = useState(false);

  function run() {
    setError(null);
    startTransition(async () => {
      const res = await summarizeReviewAction({ reviewId });
      if (!res.ok) return setError(res.error);
      setStubbed(res.stubbed);
      router.refresh();
    });
  }

  async function copy() {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summaryMarkdown(summary));
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      setError("Could not copy to the clipboard.");
    }
  }

  const list = (title: string, items: string[], box = false) =>
    items.length ? (
      <div>
        <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-subtle">{title}</div>
        <ul className="mt-1 flex flex-col gap-0.5">
          {items.map((m, i) => (
            <li key={i} className="font-body text-[12px] leading-relaxed text-text">
              {box ? "☐ " : "· "}
              {m}
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  return (
    <Panel
      title="Round debrief"
      eyebrow={summaryAt ? `Summarised ${new Date(summaryAt).toLocaleString()}${summary?.fallback ? " · from the comments themselves" : summary?.model ? ` · ${summary.model}` : ""}` : "AI summary of the consolidated comments"}
      accent="plum"
      actions={
        <div className="flex items-center gap-2">
          {summary ? (
            <button type="button" onClick={() => void copy()} className="aur-btn aur-btn-ghost text-[11px]">
              {copied ? "Copied" : "Copy"}
            </button>
          ) : null}
          <button type="button" onClick={run} disabled={pending} className="aur-btn aur-btn-primary text-[11px] disabled:opacity-50">
            {pending ? "Reading…" : summary ? "Summarise again" : "Summarise this round"}
          </button>
        </div>
      }
    >
      {error ? <div className="mb-2 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">{error}</div> : null}
      {stubbed ? <StubModeBanner variant="inline" /> : null}
      {!summary ? (
        <p className="font-body text-[12px] text-muted">
          One click reads every reviewer's comments, the verdicts and the checklist, and writes the debrief: themes, must-fix items, strengths to keep, next steps. Counts one AI request.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="font-display text-[14px] font-semibold leading-snug text-text">{summary.headline}</p>
          {summary.themes.length ? (
            <div>
              <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-subtle">Themes</div>
              <ul className="mt-1 flex flex-col gap-1.5">
                {summary.themes.map((t, i) => (
                  <li key={i} className="rounded-md border border-layer/10 bg-layer/[0.02] px-3 py-2">
                    <div className="font-body text-[12px] font-semibold text-text">{t.title}</div>
                    <div className="font-body text-[12px] leading-relaxed text-muted">{t.detail}</div>
                    {t.sections.length ? <div className="mt-1 font-mono text-[10px] text-subtle">{t.sections.join(" · ")}</div> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {list("Must fix", summary.mustFix, true)}
          {list("Strengths to keep", summary.strengths)}
          {list("Next steps", summary.nextSteps)}
        </div>
      )}
    </Panel>
  );
}
