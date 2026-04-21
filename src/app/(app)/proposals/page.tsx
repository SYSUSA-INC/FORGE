"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusPill } from "@/components/ui/StatusPill";
import { BarMeter } from "@/components/ui/BarMeter";
import { KanbanBoard } from "@/components/proposals/KanbanBoard";
import { useProposals, proposalsStore } from "@/lib/proposalsStore";

export default function ProposalsListPage() {
  const proposals = useProposals();

  const counts = {
    total: proposals.length,
    draft: proposals.filter((p) =>
      ["OUTLINING", "DRAFTING", "REVISING"].includes(p.status),
    ).length,
    review: proposals.filter((p) =>
      ["PINK_TEAM", "RED_TEAM", "GOLD_TEAM", "FINAL_REVIEW"].includes(p.status),
    ).length,
    atRisk: proposals.filter((p) => p.daysLeft < 5).length,
  };

  return (
    <>
      <PageHeader
        eyebrow="Proposals — Pipeline"
        title="Proposals"
        subtitle="Every active proposal across capture, drafting, review, and production. Drag a card to change its phase."
        actions={
          <>
            <button
              type="button"
              className="aur-btn"
              onClick={() => {
                if (confirm("Clear all local proposals?")) proposalsStore.clear();
              }}
            >
              Clear all
            </button>
            <Link href="/proposals/new" className="aur-btn-primary">
              + New proposal
            </Link>
          </>
        }
        meta={[
          { label: "Total", value: String(counts.total).padStart(2, "0") },
          {
            label: "In draft",
            value: String(counts.draft).padStart(2, "0"),
            accent: counts.draft > 0 ? "gold" : undefined,
          },
          {
            label: "In review",
            value: String(counts.review).padStart(2, "0"),
            accent: counts.review > 0 ? "emerald" : undefined,
          },
          {
            label: "At risk (<5d)",
            value: String(counts.atRisk).padStart(2, "0"),
            accent: counts.atRisk > 0 ? "rose" : undefined,
          },
        ]}
      />

      <div className="mb-6">
        <KanbanBoard proposals={proposals} />
      </div>

      <Panel title="Proposal register" dense>
        {proposals.length === 0 ? (
          <div className="flex flex-col items-start gap-2 px-5 py-8 text-[13px] text-muted">
            <span>No proposals yet.</span>
            <Link
              href="/proposals/new"
              className="aur-btn-ghost px-0 py-0 text-[12px]"
            >
              Create your first proposal →
            </Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[130px_1fr_140px_110px_120px_110px_100px] border-b border-white/10 bg-white/[0.04] font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
              <div className="border-r border-white/10 p-2">ID · status</div>
              <div className="border-r border-white/10 p-2">Title / solicitation</div>
              <div className="border-r border-white/10 p-2">Due</div>
              <div className="border-r border-white/10 p-2">Progress</div>
              <div className="border-r border-white/10 p-2">Compliance</div>
              <div className="border-r border-white/10 p-2">Pages</div>
              <div className="p-2">Open</div>
            </div>
            {proposals.map((p) => (
              <div
                key={p.id}
                className="grid grid-cols-[130px_1fr_140px_110px_120px_110px_100px] items-center border-b border-white/10 hover:bg-white/[0.03]"
              >
                <div className="border-r border-white/10 p-3">
                  <div className="font-mono text-[10px] uppercase text-muted">{p.code}</div>
                  <div className="mt-1">
                    <StatusPill value={p.status} />
                  </div>
                </div>
                <div className="border-r border-white/10 p-3">
                  <div className="font-display text-base font-semibold leading-tight text-text">
                    {p.title}
                  </div>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-muted">
                    {p.solicitation || "—"} · {p.agency || "—"}
                  </div>
                </div>
                <div className="border-r border-white/10 p-3 font-mono text-[11px]">
                  <div className="font-semibold text-text">{p.dueAt || "—"}</div>
                  <div
                    className={`mt-1 rounded-md border px-1.5 py-0.5 text-center font-display text-sm font-semibold leading-none ${
                      p.daysLeft < 5
                        ? "border-rose/40 bg-rose/15 text-rose"
                        : p.daysLeft < 15
                          ? "border-gold/40 bg-gold/15 text-gold"
                          : "border-white/10 bg-white/5 text-text"
                    }`}
                  >
                    {p.daysLeft}d
                  </div>
                </div>
                <div className="border-r border-white/10 p-3">
                  <BarMeter value={p.progress} right={`${p.progress}%`} />
                </div>
                <div className="border-r border-white/10 p-3">
                  <BarMeter
                    value={p.compliancePct}
                    color={
                      p.compliancePct >= 90
                        ? "emerald"
                        : p.compliancePct >= 70
                          ? "gold"
                          : "rose"
                    }
                    right={`${p.compliancePct}%`}
                  />
                </div>
                <div className="border-r border-white/10 p-3 font-mono text-[11px]">
                  <div className="font-semibold text-text">
                    {p.pagesEstimated}/{p.pagesLimit}p
                  </div>
                  <div className="text-[10px] text-muted">AI {p.aiPct}%</div>
                </div>
                <div className="p-2">
                  <Link
                    href={`/proposals/${p.id}/editor`}
                    className="aur-btn w-full px-2 py-1 text-[10px]"
                  >
                    Open
                  </Link>
                </div>
              </div>
            ))}
          </>
        )}
      </Panel>
    </>
  );
}
