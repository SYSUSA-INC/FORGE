"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import type { ProposalStage } from "@/db/schema";
import { STAGES } from "@/lib/proposal-types";

type ProposalRow = {
  id: string;
  title: string;
  stage: ProposalStage;
  stageLabel: string;
  stageColor: string;
  oppId: string;
  oppTitle: string;
  oppAgency: string;
  oppSolicitation: string;
  pmName: string | null;
  pmEmail: string | null;
  dueDate: string | null;
  submittedAt: string | null;
  updatedAt: string;
};

// Two top-level workspaces. "In-flight" = anything actively being
// authored or color-team reviewed. "Past proposals" = past the launch
// button — submitted, awarded, lost, no_bid, archived.
const IN_FLIGHT_STAGES = new Set<ProposalStage>([
  "draft",
  "pink_team",
  "red_team",
  "gold_team",
  "white_gloves",
]);
const SUBMITTED_STAGES = new Set<ProposalStage>([
  "submitted",
  "awarded",
  "lost",
  "no_bid",
  "archived",
]);

type Tab = "in_flight" | "submitted";

export function ProposalsClient({
  proposals,
  stageCounts,
}: {
  proposals: ProposalRow[];
  stageCounts: Record<string, number>;
}) {
  const [tab, setTab] = useState<Tab>("in_flight");
  const [filter, setFilter] = useState("");
  const [stageFilter, setStageFilter] = useState<ProposalStage | "all">("all");

  // When a user switches tabs, drop any stage filter — its options
  // change with the tab, so carrying it across is jarring.
  function selectTab(t: Tab) {
    setTab(t);
    setStageFilter("all");
  }

  const stagesForTab = useMemo(
    () =>
      STAGES.filter((s) =>
        tab === "in_flight"
          ? IN_FLIGHT_STAGES.has(s.key)
          : SUBMITTED_STAGES.has(s.key),
      ),
    [tab],
  );

  const inTab = useMemo(
    () =>
      proposals.filter((p) =>
        tab === "in_flight"
          ? IN_FLIGHT_STAGES.has(p.stage)
          : SUBMITTED_STAGES.has(p.stage),
      ),
    [proposals, tab],
  );

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return inTab.filter((p) => {
      if (stageFilter !== "all" && p.stage !== stageFilter) return false;
      if (!f) return true;
      return (
        p.title.toLowerCase().includes(f) ||
        p.oppTitle.toLowerCase().includes(f) ||
        p.oppAgency.toLowerCase().includes(f) ||
        p.oppSolicitation.toLowerCase().includes(f) ||
        (p.pmName ?? "").toLowerCase().includes(f) ||
        (p.pmEmail ?? "").toLowerCase().includes(f)
      );
    });
  }, [inTab, filter, stageFilter]);

  const inFlightCount = useMemo(
    () =>
      [...IN_FLIGHT_STAGES].reduce(
        (sum, s) => sum + (stageCounts[s] ?? 0),
        0,
      ),
    [stageCounts],
  );
  const submittedCount = useMemo(
    () =>
      [...SUBMITTED_STAGES].reduce(
        (sum, s) => sum + (stageCounts[s] ?? 0),
        0,
      ),
    [stageCounts],
  );

  const inReview =
    (stageCounts.pink_team ?? 0) +
    (stageCounts.red_team ?? 0) +
    (stageCounts.gold_team ?? 0) +
    (stageCounts.white_gloves ?? 0);

  return (
    <>
      <PageHeader
        eyebrow="Proposals"
        title="Proposals"
        subtitle="Manage proposals through Pink → Red → Gold → White Gloves reviews."
        actions={
          <Link href="/proposals/new" className="aur-btn aur-btn-primary">
            + New proposal
          </Link>
        }
        meta={[
          { label: "Total", value: String(proposals.length) },
          { label: "Draft", value: String(stageCounts.draft ?? 0) },
          { label: "In review", value: String(inReview) },
          {
            label: "Submitted",
            value: String(stageCounts.submitted ?? 0),
            accent: stageCounts.submitted ? "emerald" : undefined,
          },
        ]}
      />

      <div className="mb-3 flex items-center gap-1 border-b border-white/10">
        <TabButton
          active={tab === "in_flight"}
          onClick={() => selectTab("in_flight")}
          label="In flight"
          count={inFlightCount}
        />
        <TabButton
          active={tab === "submitted"}
          onClick={() => selectTab("submitted")}
          label="Past proposals"
          count={submittedCount}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setStageFilter("all")}
          className={`rounded-md border px-3 py-1 font-mono text-[11px] uppercase tracking-[0.2em] transition-colors ${
            stageFilter === "all"
              ? "border-teal-400 bg-teal-400/10 text-text"
              : "border-white/10 bg-white/[0.02] text-muted hover:border-white/20"
          }`}
        >
          All {inTab.length}
        </button>
        {stagesForTab.map((s) => {
          const n = stageCounts[s.key] ?? 0;
          if (n === 0 && stageFilter !== s.key) return null;
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
        title={
          stageFilter === "all"
            ? tab === "in_flight"
              ? "In-flight proposals"
              : "Past proposals"
            : STAGES.find((s) => s.key === stageFilter)?.label
        }
        eyebrow={`${filtered.length} of ${inTab.length}`}
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
            No proposals match.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {filtered.map((p) => (
              <ProposalRowItem key={p.id} p={p} />
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative -mb-px px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] transition-colors ${
        active
          ? "border-b-2 border-teal text-text"
          : "border-b-2 border-transparent text-muted hover:text-text"
      }`}
    >
      {label}
      <span
        className={`ml-2 rounded px-1.5 py-0.5 text-[10px] ${
          active ? "bg-teal/15 text-teal" : "bg-white/5 text-muted"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function ProposalRowItem({ p }: { p: ProposalRow }) {
  const due = p.dueDate ? new Date(p.dueDate).toLocaleDateString() : null;
  return (
    <Link
      href={`/proposals/${p.id}`}
      className="grid grid-cols-1 items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-3 transition-colors hover:border-white/20 md:grid-cols-[1fr_auto_auto_auto]"
    >
      <div className="min-w-0">
        <div className="truncate font-display text-[14px] font-semibold text-text">
          {p.title}
        </div>
        <div className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          {p.oppAgency || "—"}
          {p.oppSolicitation ? ` · ${p.oppSolicitation}` : ""}
        </div>
      </div>
      <span
        className="rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-[0.22em]"
        style={{
          color: p.stageColor,
          backgroundColor: `${p.stageColor}1A`,
          border: `1px solid ${p.stageColor}40`,
        }}
      >
        {p.stageLabel}
      </span>
      <div className="font-mono text-[11px] text-muted">
        <div>Due</div>
        <div className={due ? "text-text" : "text-muted"}>{due ?? "—"}</div>
      </div>
      <div className="font-mono text-[11px] text-muted">
        <div>PM</div>
        <div className="text-text">{p.pmName ?? p.pmEmail ?? "Unassigned"}</div>
      </div>
    </Link>
  );
}
