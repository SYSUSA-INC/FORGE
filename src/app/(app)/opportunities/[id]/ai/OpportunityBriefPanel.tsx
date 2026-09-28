"use client";

import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { StubModeBanner } from "@/components/ui/StubModeBanner";
import {
  RECOMMENDATION_LABELS,
  type BriefFeedback,
  type BriefTrack,
  type StoredBrief,
} from "@/lib/brief-logic";
import { generateOpportunityBriefAction, setBriefFeedbackAction } from "./actions";

/**
 * BL-AIP-7a — the pursuit brief: stored (the last one shows on load),
 * grounded (model PWin, recompete, customer record, loss patterns,
 * Brain), with the model's call, the reader's feedback and, once the
 * pursuit closes, the grade.
 */
export function OpportunityBriefPanel({
  opportunityId,
  initial,
  track,
}: {
  opportunityId: string;
  initial: StoredBrief | null;
  track: BriefTrack;
}) {
  const [pending, startTransition] = useTransition();
  const [brief, setBrief] = useState<StoredBrief | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string>("");

  function generate(force: boolean) {
    setError(null);
    setNote("");
    startTransition(async () => {
      const res = await generateOpportunityBriefAction(opportunityId, { force });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setBrief(res.brief);
      if (res.reused) setNote("Nothing that matters has changed since the last brief; showing it.");
    });
  }

  function feedback(value: BriefFeedback) {
    if (!brief) return;
    startTransition(async () => {
      const res = await setBriefFeedbackAction(brief.id, value);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setBrief({ ...brief, feedback: value });
    });
  }

  const trackText =
    track.n === 0
      ? "No graded calls yet"
      : `Track: ${track.correct} right, ${track.wrong} wrong${track.inconclusive ? `, ${track.inconclusive} hedged` : ""}${track.accuracy !== null ? ` · ${Math.round(track.accuracy * 100)}%` : ""}`;

  return (
    <Panel
      title="AI pursuit brief"
      eyebrow={trackText}
      actions={
        <button
          type="button"
          className={`aur-btn text-[11px] ${brief ? "aur-btn-ghost" : "aur-btn-primary"}`}
          disabled={pending}
          onClick={() => generate(!!brief)}
        >
          {pending ? "Reading the record…" : brief ? "Regenerate" : "Generate brief"}
        </button>
      }
    >
      {error ? (
        <div className="mb-3 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
      {note ? <p className="mb-3 font-mono text-[11px] text-muted">{note}</p> : null}

      {!brief ? (
        <p className="font-body text-[13px] leading-relaxed text-muted">
          Click <span className="text-text">Generate brief</span> for a pursue / watch /
          no-bid call grounded in the calibrated PWin and its factors, past bids that look
          like this one, your record at this agency, the patterns you have lost on, and
          matching passages from your own corpus. Briefs are kept, and graded against the
          outcome when the pursuit closes.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {brief.recommendation ? (
              <span
                className={`rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${
                  brief.recommendation === "pursue"
                    ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : brief.recommendation === "no_bid"
                      ? "border border-rose-500/40 bg-rose-500/10 text-rose-300"
                      : "border border-amber-500/40 bg-amber-500/10 text-amber-200"
                }`}
              >
                {RECOMMENDATION_LABELS[brief.recommendation]}
              </span>
            ) : null}
            {brief.confidence !== null ? (
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
                confidence {Math.round(brief.confidence * 100)}%
              </span>
            ) : null}
            {brief.grade ? (
              <span
                className={`font-mono text-[10px] uppercase tracking-widest ${
                  brief.grade === "correct"
                    ? "text-emerald-300"
                    : brief.grade === "wrong"
                      ? "text-rose-300"
                      : "text-muted"
                }`}
              >
                graded {brief.grade} · closed {brief.outcome?.replace("_", " ")}
              </span>
            ) : null}
          </div>

          <div className="font-body text-[14px] leading-relaxed text-text whitespace-pre-wrap">
            {brief.text}
          </div>

          {brief.signals.length > 0 ? (
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
                What drove the call
              </div>
              <ul className="list-disc space-y-0.5 pl-5 font-body text-[13px] text-text">
                {brief.signals.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {brief.nextActions.length > 0 ? (
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
                Next actions
              </div>
              <ul className="list-disc space-y-0.5 pl-5 font-body text-[13px] text-text">
                {brief.nextActions.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-layer/10 pt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-subtle">
            <span>
              {brief.stubbed ? <StubModeBanner variant="inline" /> : null}
              <span className="text-muted">Model:</span>{" "}
              <span className="text-text normal-case">{brief.model || "—"}</span>{" "}
              <span className="text-muted">· Generated:</span>{" "}
              <span className="text-text normal-case">{new Date(brief.createdAt).toLocaleString()}</span>{" "}
              <span className="text-muted">· Prompt:</span>{" "}
              <span className="text-text normal-case">{brief.promptVersion}</span>
            </span>
            <span className="flex items-center gap-1 normal-case tracking-normal">
              <span className="text-muted">Was this useful?</span>
              <button
                type="button"
                className={`aur-btn aur-btn-ghost text-[11px] ${brief.feedback === "useful" ? "text-emerald-300" : ""}`}
                disabled={pending}
                onClick={() => feedback("useful")}
              >
                Yes
              </button>
              <button
                type="button"
                className={`aur-btn aur-btn-ghost text-[11px] ${brief.feedback === "not_useful" ? "text-rose-300" : ""}`}
                disabled={pending}
                onClick={() => feedback("not_useful")}
              >
                No
              </button>
            </span>
          </div>
        </div>
      )}
    </Panel>
  );
}
