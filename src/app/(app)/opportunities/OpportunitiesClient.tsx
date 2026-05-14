"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import type { OpportunityStage } from "@/db/schema";
import { SendForReviewButton } from "./[id]/review/SendForReviewButton";
import { formatDollarRange } from "@/lib/money";
import { StageWidget, spellOutStageCode } from "./StageWidget";
import { formatDueProximity, type StageStat } from "./stage-stats";

type Opp = {
  id: string;
  title: string;
  agency: string;
  stage: OpportunityStage;
  stageLabel: string;
  stageColor: string;
  solicitationNumber: string;
  valueLow: string;
  valueHigh: string;
  responseDueDate: string | null;
  pWin: number;
  owner: { userId: string; name: string | null; email: string } | null;
  updatedAt: string;
};

type StageConfig = {
  key: OpportunityStage;
  label: string;
  shortLabel: string;
  color: string;
};

export function OpportunitiesClient({
  opportunities,
  stageStats,
  stages,
  initialStageFilter = "all",
}: {
  opportunities: Opp[];
  /** Map of stage key → server-aggregated stats. Missing keys = zero. */
  stageStats: Record<string, StageStat>;
  stages: StageConfig[];
  /** Pre-applied stage filter from URL (?stage=capture). Used when
   *  drilled into from the Command Center tiles. */
  initialStageFilter?: OpportunityStage | "all";
}) {
  const [filter, setFilter] = useState("");
  const [stageFilter, setStageFilter] = useState<OpportunityStage | "all">(
    initialStageFilter,
  );

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return opportunities.filter((o) => {
      if (stageFilter !== "all" && o.stage !== stageFilter) return false;
      if (!f) return true;
      return (
        o.title.toLowerCase().includes(f) ||
        o.agency.toLowerCase().includes(f) ||
        o.solicitationNumber.toLowerCase().includes(f) ||
        (o.owner?.name ?? "").toLowerCase().includes(f) ||
        (o.owner?.email ?? "").toLowerCase().includes(f)
      );
    });
  }, [opportunities, filter, stageFilter]);

  const total = opportunities.length;
  const captureCount =
    (stageStats.identified?.count ?? 0) +
    (stageStats.sources_sought?.count ?? 0) +
    (stageStats.qualification?.count ?? 0) +
    (stageStats.capture?.count ?? 0);
  const proposalCount =
    (stageStats.pre_proposal?.count ?? 0) +
    (stageStats.writing?.count ?? 0) +
    (stageStats.submitted?.count ?? 0);
  const wonCount = stageStats.won?.count ?? 0;

  return (
    <>
      <PageHeader
        eyebrow="Capture"
        title="Opportunities"
        subtitle="Track opportunities from identification through submission."
        actions={
          <>
            <Link href="/opportunities/import" className="aur-btn aur-btn-ghost">
              Import from SAM.gov
            </Link>
            <Link href="/opportunities/new" className="aur-btn aur-btn-primary">
              + New opportunity
            </Link>
          </>
        }
        meta={[
          { label: "Total", value: String(total) },
          { label: "In capture", value: String(captureCount) },
          { label: "In proposal", value: String(proposalCount) },
          {
            label: "Won",
            value: String(wonCount),
            accent: wonCount ? "emerald" : undefined,
          },
        ]}
      />

      {/* Widget grid: 10 stages, click to filter. The "All" tile is
          a sibling so the click target for "no filter" is consistent
          in style with the rest. */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        <button
          type="button"
          onClick={() => setStageFilter("all")}
          aria-pressed={stageFilter === "all"}
          className={`flex flex-col gap-2 rounded-lg border bg-white/[0.02] p-3 text-left transition-colors ${
            stageFilter === "all"
              ? "border-2 border-white/40 bg-white/[0.06]"
              : "border-white/10 hover:border-white/30"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="rounded-sm border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em] text-muted">
              All
            </div>
            <div className="font-display text-2xl font-semibold leading-none tabular-nums text-text">
              {total}
            </div>
          </div>
          <div className="font-display text-[14px] font-semibold text-text leading-tight">
            Everything
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
            All stages
          </div>
        </button>

        {stages.map((s) => {
          const stat = stageStats[s.key] ?? {
            count: 0,
            soonestDue: null,
            pastDueCount: 0,
            totalValueLow: 0,
            totalValueHigh: 0,
          };
          const dueDate = stat.soonestDue ? new Date(stat.soonestDue) : null;
          return (
            <StageWidget
              key={s.key}
              shortLabel={s.shortLabel}
              descriptiveLabel={s.label}
              spellOut={spellOutStageCode(s.shortLabel)}
              count={stat.count}
              color={s.color}
              dueProximity={formatDueProximity(dueDate)}
              pastDueCount={stat.pastDueCount}
              valueRange={formatDollarRange(
                stat.totalValueLow,
                stat.totalValueHigh,
              )}
              active={stageFilter === s.key}
              onClick={() => setStageFilter(s.key)}
            />
          );
        })}
      </div>

      <Panel
        title={
          stageFilter === "all"
            ? "All opportunities"
            : `${spellOutStageCode(
                stages.find((s) => s.key === stageFilter)?.shortLabel ?? "",
              )} · ${stages.find((s) => s.key === stageFilter)?.label ?? ""}`
        }
        eyebrow={`${filtered.length} of ${total}`}
        actions={
          <input
            className="aur-input w-64 text-[12px]"
            placeholder="Search title, agency, owner…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        }
      >
        {filtered.length === 0 ? (
          <div className="font-mono text-[11px] text-muted">
            No opportunities match.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {filtered.map((o) => (
              <OppRow key={o.id} o={o} />
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function OppRow({ o }: { o: Opp }) {
  const valueRange =
    o.valueLow || o.valueHigh
      ? `${o.valueLow || "—"} – ${o.valueHigh || "—"}`
      : "—";
  const due = o.responseDueDate
    ? new Date(o.responseDueDate).toLocaleDateString()
    : null;

  return (
    <div className="grid grid-cols-1 items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 transition-colors hover:border-white/20 md:grid-cols-[1fr_auto_auto_auto_auto_auto]">
      <Link href={`/opportunities/${o.id}`} className="min-w-0">
        <div className="truncate font-display text-[14px] font-semibold text-text">
          {o.title}
        </div>
        <div className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          {o.agency || "—"}
          {o.solicitationNumber ? ` · ${o.solicitationNumber}` : ""}
        </div>
      </Link>
      <span
        className="rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-[0.22em]"
        style={{
          color: o.stageColor,
          backgroundColor: `${o.stageColor}1A`,
          border: `1px solid ${o.stageColor}40`,
        }}
      >
        {o.stageLabel}
      </span>
      <div className="font-mono text-[11px] text-muted">
        <div className="text-muted">Value</div>
        <div className="text-text">{valueRange}</div>
      </div>
      <div className="font-mono text-[11px] text-muted">
        <div className="text-muted">Due</div>
        <div className={due ? "text-text" : "text-muted"}>{due ?? "—"}</div>
      </div>
      <div className="font-mono text-[11px] text-muted">
        <div className="text-muted">Owner</div>
        <div className="text-text">
          {o.owner ? (o.owner.name ?? o.owner.email) : "Unassigned"}
        </div>
      </div>
      <SendForReviewButton opportunityId={o.id} size="sm" />
    </div>
  );
}
