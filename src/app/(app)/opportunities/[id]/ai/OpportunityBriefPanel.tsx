"use client";

import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import {
  generateOpportunityBriefAction,
  type OpportunityBriefError,
  type OpportunityBriefResult,
} from "./actions";

export function OpportunityBriefPanel({
  opportunityId,
}: {
  opportunityId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [brief, setBrief] = useState<OpportunityBriefResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function generate(force: boolean) {
    setError(null);
    startTransition(async () => {
      const res = await generateOpportunityBriefAction(opportunityId, { force });
      if (!res.ok) {
        setError((res as OpportunityBriefError).error);
        return;
      }
      setBrief(res);
    });
  }

  return (
    <Panel
      title="AI pursuit brief"
      eyebrow="One-paragraph take on this opportunity"
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
          Click <span className="text-text">Generate brief</span> to get a
          5–8 sentence take on this opportunity — pursue / watch /
          consider-no-bid plus the specific signals from PWin, evaluation,
          competitors, and recent activity. Cached for 5 minutes; click{" "}
          <span className="text-text">Regenerate</span> to bypass.
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

function BriefMeta({ brief }: { brief: OpportunityBriefResult }) {
  const meta: { label: string; value: string }[] = [
    { label: "Provider", value: brief.provider },
    { label: "Model", value: brief.model },
    {
      label: "Generated",
      value: new Date(brief.generatedAt).toLocaleString(),
    },
  ];
  if (typeof brief.inputTokens === "number") {
    meta.push({ label: "Input", value: String(brief.inputTokens) });
  }
  if (typeof brief.outputTokens === "number") {
    meta.push({ label: "Output", value: String(brief.outputTokens) });
  }

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
