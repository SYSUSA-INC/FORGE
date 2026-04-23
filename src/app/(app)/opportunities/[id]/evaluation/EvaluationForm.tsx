"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { OpportunityEvaluation } from "@/db/schema";
import {
  EVALUATION_DIMENSIONS,
  evaluationRollup,
} from "@/lib/evaluation-types";
import { saveEvaluationAction } from "../evaluation-actions";

export function EvaluationForm({
  opportunityId,
  initial,
}: {
  opportunityId: string;
  initial: OpportunityEvaluation | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [scores, setScores] = useState({
    strategicFit: initial?.strategicFit ?? 50,
    customerRelationship: initial?.customerRelationship ?? 50,
    competitivePosture: initial?.competitivePosture ?? 50,
    resourceAvailability: initial?.resourceAvailability ?? 50,
    financialAttractiveness: initial?.financialAttractiveness ?? 50,
  });
  const [rationale, setRationale] = useState(initial?.rationale ?? "");

  const rollup = useMemo(
    () =>
      evaluationRollup({
        opportunityId,
        rationale,
        updatedAt: new Date(),
        ...scores,
      }),
    [opportunityId, rationale, scores],
  );

  const verdict =
    rollup >= 70 ? "Strong pursue" : rollup >= 50 ? "Watch" : "Consider no-bid";
  const verdictColor =
    rollup >= 70 ? "#10B981" : rollup >= 50 ? "#F59E0B" : "#F43F5E";

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const res = await saveEvaluationAction({
        opportunityId,
        rationale,
        ...scores,
      });
      if (!res.ok) return setError(res.error);
      setSuccess(true);
      router.refresh();
    });
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={onSubmit}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            Rollup score
          </div>
          <div
            className="mt-1 font-display text-4xl font-semibold tabular-nums"
            style={{ color: verdictColor }}
          >
            {rollup}
            <span className="ml-2 text-[13px] font-mono font-normal uppercase tracking-[0.22em]">
              / 100
            </span>
          </div>
          <div
            className="mt-1 font-mono text-[11px] uppercase tracking-[0.22em]"
            style={{ color: verdictColor }}
          >
            {verdict}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {EVALUATION_DIMENSIONS.map((d) => {
          const value = scores[d.key];
          return (
            <div key={d.key}>
              <div className="flex items-center justify-between">
                <label className="aur-label">{d.label}</label>
                <span className="font-mono text-[12px] tabular-nums text-text">
                  {value}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={value}
                onChange={(e) =>
                  setScores((s) => ({
                    ...s,
                    [d.key]: Number(e.target.value),
                  }))
                }
                className="mt-1 w-full accent-teal-400"
              />
              <div className="mt-0.5 font-mono text-[10px] text-muted">
                {d.description}
              </div>
            </div>
          );
        })}
      </div>

      <div>
        <label className="aur-label">Rationale</label>
        <textarea
          className="aur-input min-h-[100px] resize-y"
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="Notes on why you scored each dimension this way…"
        />
      </div>

      {error ? (
        <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald">
          Evaluation saved.
        </div>
      ) : null}

      <div>
        <button
          type="submit"
          disabled={pending}
          className="aur-btn aur-btn-primary py-2.5 text-sm disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save evaluation"}
        </button>
      </div>
    </form>
  );
}
