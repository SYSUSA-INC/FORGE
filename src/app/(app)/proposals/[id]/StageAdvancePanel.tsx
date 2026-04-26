"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import type { ProposalStage } from "@/db/schema";
import { STAGES, STAGE_COLORS, advanceStage } from "@/lib/proposal-types";
import { advanceProposalStageAction } from "../actions";

export function StageAdvancePanel({
  proposalId,
  currentStage,
}: {
  proposalId: string;
  currentStage: ProposalStage;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const next = advanceStage(currentStage);
  const nextDef = next ? STAGES.find((s) => s.key === next) : null;

  const terminalStages: ProposalStage[] = [
    "submitted",
    "awarded",
    "lost",
    "no_bid",
    "archived",
  ];

  const outcomeStages: ProposalStage[] = ["awarded", "lost", "no_bid"];

  function doAdvance(target: ProposalStage) {
    setError(null);
    startTransition(async () => {
      const res = await advanceProposalStageAction(proposalId, target);
      if (!res.ok) return setError(res.error);
      if (outcomeStages.includes(target)) {
        router.push(`/proposals/${proposalId}/outcome`);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Panel title="Workflow" eyebrow="Color team progression">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-1">
          {STAGES.filter((s) =>
            ["draft", "pink_team", "red_team", "gold_team", "white_gloves", "submitted"].includes(
              s.key,
            ),
          ).map((s, i, arr) => {
            const isCurrent = s.key === currentStage;
            const reached =
              arr.findIndex((x) => x.key === currentStage) >= i;
            return (
              <span key={s.key} className="flex items-center gap-1">
                <span
                  className={`rounded-md px-2 py-1 font-mono text-[9px] uppercase tracking-widest transition-colors ${
                    isCurrent
                      ? "text-text"
                      : reached
                        ? "text-muted"
                        : "text-subtle"
                  }`}
                  style={
                    isCurrent
                      ? {
                          color: STAGE_COLORS[s.key],
                          backgroundColor: `${STAGE_COLORS[s.key]}1A`,
                          border: `1px solid ${STAGE_COLORS[s.key]}60`,
                        }
                      : {
                          backgroundColor: reached
                            ? `${STAGE_COLORS[s.key]}12`
                            : "transparent",
                          border: `1px solid ${reached ? `${STAGE_COLORS[s.key]}30` : "rgba(255,255,255,0.1)"}`,
                        }
                  }
                >
                  {s.shortLabel}
                </span>
                {i < arr.length - 1 ? (
                  <span className="text-[10px] text-subtle">→</span>
                ) : null}
              </span>
            );
          })}
        </div>

        {next && nextDef ? (
          <div className="rounded-md border border-teal-400/30 bg-teal-400/5 p-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
              Next
            </div>
            <div className="mt-1 font-display text-[14px] font-semibold text-text">
              {nextDef.label}
            </div>
            <div className="mt-1 font-mono text-[11px] text-muted">
              {nextDef.description}
            </div>
            <button
              type="button"
              className="aur-btn aur-btn-primary mt-3 w-full py-2 text-sm"
              disabled={pending}
              onClick={() => doAdvance(next)}
            >
              {pending ? "Advancing…" : `Advance to ${nextDef.label}`}
            </button>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-white/10 p-3 font-mono text-[11px] text-muted">
            Proposal is at a terminal stage. Pick a closed state below if the
            outcome has been decided.
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            Close-out
          </div>
          <div className="grid grid-cols-2 gap-2">
            {terminalStages.map((s) => {
              const def = STAGES.find((x) => x.key === s)!;
              return (
                <button
                  key={s}
                  type="button"
                  className="aur-btn aur-btn-ghost text-[11px]"
                  disabled={pending || currentStage === s}
                  onClick={() => doAdvance(s)}
                >
                  {def.label}
                </button>
              );
            })}
          </div>
        </div>

        {error ? (
          <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
            {error}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
