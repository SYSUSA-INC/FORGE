"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import type { OpportunityStage } from "@/db/schema";
import { SendForReviewButton } from "./[id]/review/SendForReviewButton";

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
  stageCounts,
  stages,
}: {
  opportunities: Opp[];
  stageCounts: Record<string, number>;
  stages: StageConfig[];
}) {
  const [filter, setFilter] = useState("");
  const [stageFilter, setStageFilter] = useState<OpportunityStage | "all">("all");

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
          {
            label: "In capture",
            value: String(
              (stageCounts.identified ?? 0) +
                (stageCounts.sources_sought ?? 0) +
                (stageCounts.qualification ?? 0) +
                (stageCounts.capture ?? 0),
            ),
          },
          {
            label: "In proposal",
            value: String(
              (stageCounts.pre_proposal ?? 0) +
                (stageCounts.writing ?? 0) +
                (stageCounts.submitted ?? 0),
            ),
          },
          {
            label: "Won",
            value: String(stageCounts.won ?? 0),
            accent: stageCounts.won ? "emerald" : undefined,
          },
        ]}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setStageFilter("all")}
          className={`rounded-md border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors ${
            stageFilter === "all"
              ? "border-teal-400 bg-teal-400/10 text-text"
              : "border-white/10 bg-white/[0.02] text-muted hover:border-white/20"
          }`}
        >
          All {total}
        </button>
        {stages.map((s) => {
          const n = stageCounts[s.key] ?? 0;
          const active = stageFilter === s.key;
          return (
            <button
              key={s.key}
              onClick={() => setStageFilter(s.key)}
              className={`flex items-center gap-2 rounded-md border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors ${
                active
                  ? "border-teal-400 bg-teal-400/10 text-text"
                  : "border-white/10 bg-white/[0.02] text-muted hover:border-white/20"
              }`}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              {s.shortLabel} · {n}
            </button>
          );
        })}
      </div>

      <Panel
        title={stageFilter === "all" ? "All opportunities" : `Stage · ${stages.find((s) => s.key === stageFilter)?.label ?? ""}`}
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
