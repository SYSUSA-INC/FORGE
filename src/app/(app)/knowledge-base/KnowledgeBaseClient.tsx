"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Panel } from "@/components/ui/Panel";

type Entry = {
  id: string;
  kind: string;
  title: string;
  body: string;
  tags: string[];
  reuseCount: number;
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

export function KnowledgeBaseClient({
  entries,
  totalAcrossKinds,
  activeKind,
  search,
  kinds,
}: {
  entries: Entry[];
  totalAcrossKinds: number;
  activeKind: string;
  search: string;
  kinds: { key: string; label: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(search);

  function applyFilter(next: { kind?: string; q?: string }) {
    const sp = new URLSearchParams(params?.toString() ?? "");
    if (next.kind !== undefined) {
      if (!next.kind || next.kind === "all") sp.delete("kind");
      else sp.set("kind", next.kind);
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
