"use client";

import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import {
  generatePipelineBriefAction,
  type PipelineBriefError,
  type PipelineBriefResult,
} from "./actions";

type Brief = PipelineBriefResult | null;

export function PipelineBriefPanel() {
  const [pending, startTransition] = useTransition();
  const [brief, setBrief] = useState<Brief>(null);
  const [error, setError] = useState<string | null>(null);

  function generate(force: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await generatePipelineBriefAction({ force });
      if (!res.ok) {
        setError((res as PipelineBriefError).error);
        return;
      }
      setBrief(res);
    });
  }

  return (
    <Panel
      title="Pipeline brief"
      eyebrow="Live AI summary of your portfolio"
      actions={
        <div className="flex items-center gap-2">
          {brief ? (
            <button
              type="button"
              className="aur-btn aur-btn-ghost text-[11px]"
              disabled={pending}
              onClick={() => generate(true)}
            >
              {pending ? "Regenerating…" : "Regenerate"}
            </button>
          ) : null}
          {!brief ? (
            <button
              type="button"
              className="aur-btn aur-btn-primary text-[11px]"
              disabled={pending}
              onClick={() => generate(false)}
            >
              {pending ? "Generating…" : "Generate brief"}
            </button>
          ) : null}
        </div>
      }
    >
      {error ? (
        <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}

      {!brief && !error ? (
        <p className="font-body text-[13px] leading-relaxed text-muted">
          Click <span className="text-text">Generate brief</span> to get a 4–7
          sentence summary of your active opportunities and proposals — what to
          chase, what to abandon, what's at risk this week. The brief is
          cached for five minutes and re-uses the same provider configured for
          your environment (see the panel to the right).
        </p>
      ) : null}

      {brief ? (
        <div className="flex flex-col gap-3">
          <div className="font-body text-[14px] leading-relaxed text-text whitespace-pre-wrap">
            {brief.text}
          </div>
          <BriefMeta brief={brief} />
        </div>
      ) : null}
    </Panel>
  );
}

function BriefMeta({ brief }: { brief: PipelineBriefResult }) {
  const meta: { label: string; value: string }[] = [
    { label: "Provider", value: brief.provider },
    { label: "Model", value: brief.model },
    {
      label: "Generated",
      value: new Date(brief.generatedAt).toLocaleString(),
    },
  ];
  if (typeof brief.inputTokens === "number") {
    meta.push({ label: "Input tokens", value: String(brief.inputTokens) });
  }
  if (typeof brief.outputTokens === "number") {
    meta.push({ label: "Output tokens", value: String(brief.outputTokens) });
  }
  meta.push({
    label: "Snapshot",
    value: `${brief.snapshot.opportunities.total} opps · ${brief.snapshot.proposals.total} proposals · ${brief.snapshot.proposals.inActiveReview} in review`,
  });

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-white/10 pt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-subtle">
      {brief.stubbed ? (
        <span className="text-rose">stub mode (no AI provider configured)</span>
      ) : null}
      {meta.map((m) => (
        <span key={m.label}>
          <span className="text-muted">{m.label}:</span>{" "}
          <span className="text-text normal-case">{m.value}</span>
        </span>
      ))}
    </div>
  );
}
