"use client";

import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { StubModeBanner } from "@/components/ui/StubModeBanner";
import { LOSS_NARRATIVE_MIN_DECIDED } from "@/lib/loss-patterns";
import {
  generateLossNarrativeAction,
  type LossNarrativeResult,
} from "./actions";

type Narrative = Extract<LossNarrativeResult, { ok: true }>;

/**
 * BL-FB-WIN-CROSS-LOSS — on-demand AI explanation of the detected
 * patterns. Insights cite pattern ids, rendered as anchors into the
 * patterns list on the same page.
 */
export function LossNarrativePanel({
  decided,
  patternCount,
}: {
  decided: number;
  patternCount: number;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Narrative | null>(null);
  const [error, setError] = useState<string | null>(null);
  const enough = decided >= LOSS_NARRATIVE_MIN_DECIDED;

  function generate() {
    setError(null);
    startTransition(async () => {
      const res = await generateLossNarrativeAction();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult(res);
    });
  }

  return (
    <Panel
      title="What to change"
      eyebrow="AI narrative over the detected patterns"
      actions={
        <button
          type="button"
          onClick={generate}
          disabled={pending || !enough}
          className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
        >
          {pending ? "Analysing…" : result ? "Regenerate" : "Explain patterns"}
        </button>
      }
    >
      {error ? (
        <div className="mb-2 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}

      {!result && !error ? (
        <p className="font-body text-[13px] leading-relaxed text-muted">
          {enough
            ? `Turns the ${patternCount} detected pattern${patternCount === 1 ? "" : "s"} into a headline, two to four grounded insights with a concrete next action each, and the caveats you should hold in mind. Every insight cites the patterns it rests on; the model is not allowed to add its own.`
            : `Record at least ${LOSS_NARRATIVE_MIN_DECIDED} decided outcomes to unlock the narrative. ${decided} so far.`}
        </p>
      ) : null}

      {result ? (
        <div className="flex flex-col gap-3">
          <p className="font-display text-[15px] font-semibold leading-snug text-text">
            {result.narrative.headline}
          </p>
          <ol className="flex flex-col gap-2">
            {result.narrative.insights.map((ins, i) => (
              <li
                key={i}
                className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
              >
                <div className="font-display text-[13px] font-semibold text-text">
                  {i + 1}. {ins.title}
                </div>
                <p className="mt-1 font-body text-[12px] leading-relaxed text-muted">
                  {ins.explanation}
                </p>
                <p className="mt-1.5 font-body text-[12px] leading-relaxed text-text">
                  <span className="font-mono text-[9px] uppercase tracking-widest text-teal">
                    Action
                  </span>{" "}
                  {ins.action}
                </p>
                {ins.patternIds.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {ins.patternIds.map((id) => (
                      <a
                        key={id}
                        href={`#pattern-${encodeURIComponent(id)}`}
                        className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[9px] text-muted hover:border-white/30 hover:text-text"
                      >
                        {id}
                      </a>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
          {result.narrative.caveats.length > 0 ? (
            <div className="rounded-md border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2">
              <div className="font-mono text-[9px] uppercase tracking-widest text-amber-200">
                Caveats
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 font-body text-[12px] leading-relaxed text-muted">
                {result.narrative.caveats.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-white/10 pt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-subtle">
            {result.stubbed ? <StubModeBanner variant="inline" /> : null}
            <span>
              <span className="text-muted">Provider:</span>{" "}
              <span className="normal-case text-text">{result.provider}</span>
            </span>
            <span>
              <span className="text-muted">Model:</span>{" "}
              <span className="normal-case text-text">{result.model}</span>
            </span>
            <span>
              <span className="text-muted">Generated:</span>{" "}
              <span className="normal-case text-text">
                {new Date(result.generatedAt).toLocaleString()}
              </span>
            </span>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}
