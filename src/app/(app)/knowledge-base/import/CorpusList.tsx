"use client";

import { useMemo, useState } from "react";
import { ArtifactRow } from "./ArtifactRow";
import type { ListedArtifact } from "./actions";

type GroupMode = "none" | "kind";

/**
 * BL-10 Phase C-1 — corpus list with an optional group-by-kind view.
 *
 * The default "Flat" view preserves the original newest-first list.
 * "By kind" buckets artifacts under collapsible kind headers, sorted
 * by bucket size (largest first) so the dominant document types
 * surface at the top. Client-side only — no extra queries; it
 * re-buckets the already-loaded list.
 */
export function CorpusList({ artifacts }: { artifacts: ListedArtifact[] }) {
  const [mode, setMode] = useState<GroupMode>("none");

  const grouped = useMemo(() => {
    if (mode !== "kind") return null;
    const buckets = new Map<string, ListedArtifact[]>();
    for (const a of artifacts) {
      const list = buckets.get(a.kind) ?? [];
      list.push(a);
      buckets.set(a.kind, list);
    }
    // Sort buckets by size desc, then kind name asc for stable ties.
    return Array.from(buckets.entries()).sort(
      (x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0]),
    );
  }, [artifacts, mode]);

  if (artifacts.length === 0) {
    return (
      <div className="font-mono text-[11px] text-muted">
        Empty. Upload a file to seed the corpus.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
          Group by
        </span>
        <div className="flex gap-1">
          <GroupToggle
            label="Flat"
            active={mode === "none"}
            onClick={() => setMode("none")}
          />
          <GroupToggle
            label="By kind"
            active={mode === "kind"}
            onClick={() => setMode("kind")}
          />
        </div>
      </div>

      {mode === "none" || !grouped ? (
        <ul className="divide-y divide-white/5 rounded-lg border border-white/10">
          {artifacts.map((a) => (
            <ArtifactRow key={a.id} artifact={a} />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-4">
          {grouped.map(([kind, rows]) => (
            <KindGroup key={kind} kind={kind} rows={rows} />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupToggle({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2 py-1 font-mono text-[10px] uppercase tracking-widest transition-colors ${
        active
          ? "bg-teal-400/15 text-teal-300"
          : "bg-white/5 text-muted hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}

function KindGroup({ kind, rows }: { kind: string; rows: ListedArtifact[] }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg border border-white/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between border-b border-white/10 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-muted">
            {open ? "▾" : "▸"}
          </span>
          <span className="font-display text-[13px] font-semibold text-text">
            {formatKind(kind)}
          </span>
        </span>
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
          {rows.length} {rows.length === 1 ? "item" : "items"}
        </span>
      </button>
      {open ? (
        <ul className="divide-y divide-white/5">
          {rows.map((a) => (
            <ArtifactRow key={a.id} artifact={a} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function formatKind(kind: string): string {
  return kind.replace(/_/g, " ");
}
