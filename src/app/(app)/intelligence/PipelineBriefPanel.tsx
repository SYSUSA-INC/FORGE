"use client";

import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { StubModeBanner } from "@/components/ui/StubModeBanner";
import type { BriefFeedback, StoredBrief } from "@/lib/brief-logic";
import { generatePipelineBriefAction, setPipelineBriefFeedbackAction } from "./actions";

/**
 * BL-AIP-7a — the pipeline brief: stored (the last one shows on load),
 * grounded in the model's track record and the organization's loss
 * intelligence, with priorities, risks and the reader's feedback.
 */
export function PipelineBriefPanel({ initial }: { initial: StoredBrief | null }) {
  const [pending, startTransition] = useTransition();
  const [brief, setBrief] = useState<StoredBrief | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string>("");

  function generate(force: boolean) {
    setError(null);
    setNote("");
    startTransition(async () => {
      const res = await generatePipelineBriefAction({ force });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setBrief(res.brief);
      if (res.reused) setNote("Nothing has changed since today's brief; showing it.");
    });
  }

  function feedback(value: BriefFeedback) {
    if (!brief) return;
    startTransition(async () => {
      const res = await setPipelineBriefFeedbackAction(brief.id, value);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setBrief({ ...brief, feedback: value });
    });
  }

  return (
    <Panel
      title="Pipeline brief"
      eyebrow="Stored daily take on your portfolio, grounded in your loss intelligence"
      actions={
        <button
          type="button"
          className={`aur-btn text-[11px] ${brief ? "aur-btn-ghost" : "aur-btn-primary"}`}
          disabled={pending}
          onClick={() => generate(!!brief)}
        >
          {pending ? "Reading the pipeline…" : brief ? "Regenerate" : "Generate brief"}
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
          Click <span className="text-text">Generate brief</span> for a 4–7 sentence take on your
          active opportunities and proposals — what to chase, what to abandon, what is at risk
          this week — with the PWin model&apos;s track record and the patterns you have lost on
          in view. Briefs are kept; a new one is written when the pipeline changes.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="font-body text-[14px] leading-relaxed text-text whitespace-pre-wrap">
            {brief.text}
          </div>
          {brief.nextActions.length > 0 ? (
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
                Priorities this week
              </div>
              <ul className="list-disc space-y-0.5 pl-5 font-body text-[13px] text-text">
                {brief.nextActions.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {brief.signals.length > 0 ? (
            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-subtle">
                Risks
              </div>
              <ul className="list-disc space-y-0.5 pl-5 font-body text-[13px] text-text">
                {brief.signals.map((s) => (
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
              <span className="text-text normal-case">{new Date(brief.createdAt).toLocaleString()}</span>
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
