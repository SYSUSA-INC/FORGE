"use client";

import { FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import type { OpportunityStage } from "@/db/schema";
import { STAGES } from "@/lib/opportunity-types";
import { setStageWithLogAction } from "../evaluation-actions";

type Decision = "advance" | "no_bid" | "lost";

export function GateDecisionPanel({
  opportunityId,
  currentStage,
}: {
  opportunityId: string;
  currentStage: OpportunityStage;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reasoning, setReasoning] = useState("");
  const [decision, setDecision] = useState<Decision>("advance");
  const [targetStage, setTargetStage] = useState<OpportunityStage>(() =>
    nextStage(currentStage),
  );

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const nextStageKey: OpportunityStage =
      decision === "no_bid"
        ? "no_bid"
        : decision === "lost"
          ? "lost"
          : targetStage;
    if (!reasoning.trim()) {
      setError("Enter the reason for the decision.");
      return;
    }
    startTransition(async () => {
      const res = await setStageWithLogAction(
        opportunityId,
        nextStageKey,
        reasoning,
      );
      if (!res.ok) return setError(res.error);
      setReasoning("");
      router.refresh();
    });
  }

  return (
    <Panel title="Gate decision" eyebrow="Advance, no-bid, or loss">
      <form className="flex flex-col gap-3" onSubmit={onSubmit}>
        <div>
          <label className="aur-label">Decision</label>
          <select
            className="aur-input"
            value={decision}
            onChange={(e) => setDecision(e.target.value as Decision)}
          >
            <option value="advance">Advance stage</option>
            <option value="no_bid">Declare no-bid</option>
            <option value="lost">Record as lost</option>
          </select>
        </div>

        {decision === "advance" ? (
          <div>
            <label className="aur-label">Move to stage</label>
            <select
              className="aur-input"
              value={targetStage}
              onChange={(e) => setTargetStage(e.target.value as OpportunityStage)}
            >
              {STAGES.filter(
                (s) =>
                  s.phase !== "closed" ||
                  s.key === "won" ||
                  s.key === currentStage,
              ).map((s) => (
                <option key={s.key} value={s.key}>
                  {s.shortLabel} · {s.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div>
          <label className="aur-label">Reasoning</label>
          <textarea
            className="aur-input min-h-[100px] resize-y"
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value)}
            placeholder="Why this decision? Who approved? What changed?"
          />
        </div>

        {error ? (
          <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className={`aur-btn py-2.5 text-sm disabled:opacity-60 ${
            decision === "no_bid" || decision === "lost"
              ? "aur-btn-danger"
              : "aur-btn-primary"
          }`}
        >
          {pending ? "Saving…" : "Record decision"}
        </button>
      </form>
    </Panel>
  );
}

function nextStage(current: OpportunityStage): OpportunityStage {
  const order: OpportunityStage[] = [
    "identified",
    "sources_sought",
    "qualification",
    "capture",
    "pre_proposal",
    "writing",
    "submitted",
    "won",
  ];
  const idx = order.indexOf(current);
  if (idx === -1 || idx === order.length - 1) return current;
  return order[idx + 1]!;
}
