"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Panel } from "@/components/ui/Panel";

type OutcomeLabel = "none" | "won" | "lost" | "no_bid" | "withdrawn";

type Entry = {
  id: string;
  kind: string;
  title: string;
  body: string;
  tags: string[];
  reuseCount: number;
  outcomeLabel: OutcomeLabel;
  archivedAt: string | null;
  updatedAt: string;
};

const KIND_COLOR: Record<string, string> = {
  capability: "#2DD4BF",
  past_performance: "#EC4899",
  personnel: "#A78BFA",
  boilerplate: "#9BC9D9",
};

const KIND_LABEL: Record<string, string> = {
  capability: "Capability",
  past_performance: "Past performance",
  personnel: "Personnel",
  boilerplate: "Boilerplate",
};

const OUTCOME_TONES: Record<OutcomeLabel, string> = {
  none: "",
  won: "bg-emerald-400/15 text-emerald-300 border-emerald-400/40",
  lost: "bg-rose/15 text-rose border-rose/40",
  no_bid: "bg-white/5 text-muted border-white/10",
  withdrawn: "bg-amber-400/10 text-amber-200 border-amber-400/30",
};

const OUTCOME_LABELS: Record<OutcomeLabel, string> = {
  none: "—",
  won: "won",
  lost: "lost",
  no_bid: "no-bid",
  withdrawn: "withdrawn",
};

const OUTCOMES: { key: "all" | OutcomeLabel; label: string }[] = [
  { key: "all", label: "All outcomes" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
  { key: "none", label: "Untagged" },
];

export function KnowledgeBaseClient({
  entries,
  totalAcrossKinds,
  activeKind,
  activeOutcome,
  search,
  kinds,
}: {
  entries: Entry[];
  totalAcrossKinds: number;
  activeKind: string;
  activeOutcome: "all" | OutcomeLabel;
  search: string;
  kinds: { key: string; label: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(search);

  function applyFilter(next: { kind?: string; outcome?: string; q?: string }) {
    const sp = new URLSearchParams(params?.toString() ?? "");
    if (next.kind !== undefined) {
      if (!next.kind || next.kind === "all") sp.delete("kind");
      else sp.set("kind", next.kind);
    }
    if (next.outcome !== undefined) {
      if (!next.outcome || next.outcome === "all") sp.delete("outcome");
      else sp.set("outcome", next.outcome);
    }
    if (next.q !== undefined) {
      if (!next.q) sp.delete("q");
      else sp.set("q", next.q);
    }
    router.push(`/knowledge-base?${sp.toString()}`);
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <form
          className="flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            applyFilter({ q });
          }}
        >
          <label className="aur-label">Search</label>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="aur-input"
            placeholder='Title or body — e.g. "NAVSEA C5ISR", "AWS GovCloud"…'
          />
        </form>
        <div className="flex flex-wrap items-center gap-1 rounded-md border border-white/10 bg-white/[0.02] p-1">
          {kinds.map((k) => {
            const active = k.key === activeKind;
            return (
              <button
                key={k.key}
                type="button"
                onClick={() => applyFilter({ kind: k.key })}
                className={`rounded px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-widest transition-colors ${
                  active
                    ? "bg-white/10 text-text"
                    : "text-muted hover:text-text"
                }`}
              >
                {k.label}
              </button>
            );
          })}
        </div>
        <div
          className="flex flex-wrap items-center gap-1 rounded-md border border-white/10 bg-white/[0.02] p-1"
          title="Phase 14a — filter by the outcome of the proposal each entry came from."
        >
          {OUTCOMES.map((o) => {
            const active = o.key === activeOutcome;
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => applyFilter({ outcome: o.key })}
                className={`rounded px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-widest transition-colors ${
                  active
                    ? "bg-white/10 text-text"
                    : "text-muted hover:text-text"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>

      <Panel
        title="Entries"
        eyebrow={
          search || activeKind !== "all"
            ? `${entries.length} of ${totalAcrossKinds} match filters`
            : `${entries.length} total`
        }
      >
        {entries.length === 0 ? (
          <p className="font-body text-[13px] text-muted">
            No entries match the current filters.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {entries.map((e) => {
              const color = KIND_COLOR[e.kind] ?? "#9BC9D9";
              return (
                <li key={e.id} className="aur-card flex flex-col gap-2 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <span
                        className="rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest"
                        style={{
                          color,
                          backgroundColor: `${color}1A`,
                          border: `1px solid ${color}50`,
                        }}
                      >
                        {KIND_LABEL[e.kind] ?? e.kind}
                      </span>
                      {e.outcomeLabel !== "none" ? (
                        <span
                          className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${OUTCOME_TONES[e.outcomeLabel]}`}
                          title={`Came from a proposal that was ${OUTCOME_LABELS[e.outcomeLabel]}.`}
                        >
                          {OUTCOME_LABELS[e.outcomeLabel]}
                        </span>
                      ) : null}
                    </div>
                    <span className="font-mono text-[10px] text-subtle">
                      {new Date(e.updatedAt).toISOString().slice(0, 10)}
                    </span>
                  </div>
                  <Link
                    href={`/knowledge-base/${e.id}`}
                    className="font-display text-[14px] font-semibold text-text hover:underline"
                  >
                    {e.title}
                  </Link>
                  {e.body ? (
                    <p className="line-clamp-3 font-body text-[12px] leading-relaxed text-muted">
                      {e.body}
                    </p>
                  ) : null}
                  {e.tags.length > 0 ? (
                    <div className="mt-auto flex flex-wrap gap-1 pt-1">
                      {e.tags.slice(0, 6).map((t) => (
                        <span
                          key={t}
                          className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted"
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="border-t border-white/10 pt-2 font-mono text-[10px] text-subtle">
                    Used {e.reuseCount} time{e.reuseCount === 1 ? "" : "s"}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
