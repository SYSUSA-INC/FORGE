"use client";

import Link from "next/link";
import { useState } from "react";
import type { Proposal } from "@/lib/mock";
import { BarMeter } from "@/components/ui/BarMeter";
import { proposalsStore } from "@/lib/proposalsStore";

type Phase = Proposal["status"];

const PHASES: { key: Phase; label: string }[] = [
  { key: "PLANNING", label: "Planning" },
  { key: "OUTLINING", label: "Outlining" },
  { key: "DRAFTING", label: "Drafting" },
  { key: "PINK_TEAM", label: "Pink Team" },
  { key: "REVISING", label: "Revising" },
  { key: "RED_TEAM", label: "Red Team" },
  { key: "GOLD_TEAM", label: "Gold Team" },
  { key: "FINAL_REVIEW", label: "Final review" },
  { key: "PRODUCTION", label: "Production" },
  { key: "SUBMITTED", label: "Submitted" },
];

const PHASE_DOT: Record<Phase, string> = {
  PLANNING: "bg-white/20",
  OUTLINING: "bg-white/30",
  DRAFTING: "bg-violet",
  PINK_TEAM: "bg-magenta",
  REVISING: "bg-gold",
  RED_TEAM: "bg-rose",
  GOLD_TEAM: "bg-gold",
  FINAL_REVIEW: "bg-violet",
  PRODUCTION: "bg-white/60",
  SUBMITTED: "bg-emerald",
};

export function KanbanBoard({ proposals }: { proposals: Proposal[] }) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overPhase, setOverPhase] = useState<Phase | null>(null);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };

  const handleDragEnd = () => {
    setDragId(null);
    setOverPhase(null);
  };

  const handleDragOver = (e: React.DragEvent, phase: Phase) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (overPhase !== phase) setOverPhase(phase);
  };

  const handleDragLeave = (phase: Phase) => {
    if (overPhase === phase) setOverPhase(null);
  };

  const handleDrop = (e: React.DragEvent, phase: Phase) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || dragId;
    if (!id) return;
    proposalsStore.update(id, { status: phase });
    setDragId(null);
    setOverPhase(null);
    // TODO: await trpc.proposal.updateStatus.mutate({ id, status: phase });
  };

  const total = proposals.length;

  return (
    <div className="aur-card overflow-hidden">
      <header className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            Kanban · phase view
          </div>
          <div className="font-display text-[13px] font-semibold text-text">
            Drag a card to change its phase
          </div>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-subtle">
          {total} proposal{total === 1 ? "" : "s"}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-0 md:grid-cols-5 xl:grid-cols-10 xl:divide-x xl:divide-white/10">
        {PHASES.map((phase) => {
          const items = proposals.filter((p) => p.status === phase.key);
          const isOver = overPhase === phase.key;
          return (
            <div
              key={phase.key}
              onDragOver={(e) => handleDragOver(e, phase.key)}
              onDragLeave={() => handleDragLeave(phase.key)}
              onDrop={(e) => handleDrop(e, phase.key)}
              className={`flex min-h-[240px] flex-col border-b border-white/10 transition-colors xl:border-b-0 ${
                isOver ? "bg-violet/10" : "bg-transparent"
              }`}
            >
              <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                <div className="flex items-center gap-2 font-mono text-[9px] font-semibold uppercase tracking-widest">
                  <span className={`h-2 w-2 rounded-full ${PHASE_DOT[phase.key]}`} />
                  <span className="text-text">{phase.label}</span>
                </div>
                <span className="font-mono text-[10px] tabular-nums text-subtle">
                  {String(items.length).padStart(2, "0")}
                </span>
              </div>

              <div className="flex flex-1 flex-col gap-2 p-2">
                {items.map((p) => (
                  <div
                    key={p.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, p.id)}
                    onDragEnd={handleDragEnd}
                    className={`group relative cursor-grab rounded-md border border-white/10 bg-white/[0.03] p-2 transition-all hover:-translate-y-0.5 hover:border-violet/40 hover:bg-white/[0.06] active:cursor-grabbing ${
                      dragId === p.id ? "opacity-40" : ""
                    }`}
                  >
                    <Link
                      href={`/proposals/${p.id}/editor`}
                      className="block"
                      onClick={(e) => {
                        if (dragId) e.preventDefault();
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[9px] uppercase tracking-wider text-muted">
                          {p.code}
                        </span>
                        <span
                          className={`rounded-sm border px-1 py-0.5 font-mono text-[9px] font-semibold ${
                            p.daysLeft < 5
                              ? "border-rose/40 bg-rose/15 text-rose"
                              : p.daysLeft < 15
                                ? "border-gold/40 bg-gold/15 text-gold"
                                : "border-white/10 bg-white/5 text-muted"
                          }`}
                        >
                          {p.daysLeft}d
                        </span>
                      </div>
                      <div className="mt-1 line-clamp-2 font-display text-[12px] font-semibold leading-snug text-text">
                        {p.title}
                      </div>
                      <div className="mt-2">
                        <BarMeter value={p.progress} />
                      </div>
                    </Link>
                  </div>
                ))}
                {items.length === 0 ? (
                  <div className="rounded-md border border-dashed border-white/10 px-2 py-3 text-center font-mono text-[10px] text-subtle">
                    Drop here
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
