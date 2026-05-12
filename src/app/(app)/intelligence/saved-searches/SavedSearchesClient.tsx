"use client";

import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import {
  deleteSavedSearchAction,
  updateSavedSearchAction,
  type SavedSearchRow,
} from "./actions";

export function SavedSearchesClient({ rows }: { rows: SavedSearchRow[] }) {
  const [items, setItems] = useState<SavedSearchRow[]>(rows);
  const [filter, setFilter] = useState<"all" | "mine" | "shared">("all");
  const [error, setError] = useState<string | null>(null);

  const visible = items.filter((r) => {
    if (filter === "mine") return r.mine;
    if (filter === "shared") return r.shared;
    return true;
  });

  function remove(id: string) {
    const before = items;
    setItems((prev) => prev.filter((r) => r.id !== id));
    void (async () => {
      const res = await deleteSavedSearchAction(id);
      if (!res.ok) {
        setError(res.error);
        setItems(before);
      }
    })();
  }

  function toggleShared(row: SavedSearchRow) {
    const next = !row.shared;
    setItems((prev) =>
      prev.map((r) => (r.id === row.id ? { ...r, shared: next } : r)),
    );
    void (async () => {
      const res = await updateSavedSearchAction(row.id, { shared: next });
      if (!res.ok) {
        setError(res.error);
        setItems((prev) =>
          prev.map((r) => (r.id === row.id ? { ...r, shared: !next } : r)),
        );
      }
    })();
  }

  return (
    <>
      {error ? (
        <div className="mb-3 rounded border border-rose/30 bg-rose/10 px-3 py-2 font-mono text-[12px] text-rose-200">
          {error}
        </div>
      ) : null}
      <div className="mb-3 flex flex-wrap gap-1 border-b border-white/10">
        {(["all", "mine", "shared"] as const).map((f) => (
          <button
            type="button"
            key={f}
            onClick={() => setFilter(f)}
            className={`-mb-px border-b-2 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] transition-colors ${
              filter === f
                ? "border-teal-400 text-text"
                : "border-transparent text-muted hover:text-text"
            }`}
          >
            {f === "all" ? "All" : f === "mine" ? "Mine" : "Shared"} ·{" "}
            {f === "all"
              ? items.length
              : f === "mine"
                ? items.filter((r) => r.mine).length
                : items.filter((r) => r.shared).length}
          </button>
        ))}
      </div>

      <Panel title="Saved searches" eyebrow={`${visible.length} visible`} dense>
        {visible.length === 0 ? (
          <p className="px-5 py-4 font-mono text-[12px] text-muted">
            None yet. Build a search on{" "}
            <a href="/intelligence/awards" className="underline">
              /intelligence/awards
            </a>{" "}
            or{" "}
            <a href="/intelligence/firms" className="underline">
              /intelligence/firms
            </a>{" "}
            and use "Save this search" to add one.
          </p>
        ) : (
          <ul className="divide-y divide-white/5">
            {visible.map((r) => (
              <SavedSearchRowView
                key={r.id}
                row={r}
                onRemove={() => remove(r.id)}
                onToggleShared={() => toggleShared(r)}
              />
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function SavedSearchRowView({
  row,
  onRemove,
  onToggleShared,
}: {
  row: SavedSearchRow;
  onRemove: () => void;
  onToggleShared: () => void;
}) {
  const [savingShared, startShared] = useTransition();
  const summary = summarizeCriteria(row.kind, row.criteria);

  const runUrl =
    row.kind === "awards"
      ? `/intelligence/awards?savedSearch=${encodeURIComponent(row.id)}`
      : `/intelligence/firms?savedSearch=${encodeURIComponent(row.id)}`;

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
              {row.kind}
            </span>
            <span className="truncate font-display text-[13px] text-text">
              {row.name}
            </span>
            {row.shared ? (
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-emerald-200">
                Shared
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-muted">
            {summary || "(no criteria)"}
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-muted">
            {row.mine
              ? "You"
              : row.ownerEmail || "Ex-member"}
            {" · "}
            {formatDate(row.createdAt)}
            {row.lastRunAt ? ` · Last run ${formatDate(row.lastRunAt)}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a href={runUrl} className="aur-btn aur-btn-primary text-[11px]">
            Run
          </a>
          {row.mine ? (
            <>
              <button
                type="button"
                disabled={savingShared}
                onClick={() => startShared(onToggleShared)}
                className="aur-btn aur-btn-ghost text-[11px]"
              >
                {row.shared ? "Make private" : "Share"}
              </button>
              <button
                type="button"
                onClick={onRemove}
                className="aur-btn aur-btn-ghost text-[10px] uppercase tracking-[0.18em] text-rose-300 hover:text-rose-200"
              >
                Delete
              </button>
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function summarizeCriteria(
  kind: string,
  c: Record<string, unknown>,
): string {
  const parts: string[] = [];
  if (kind === "awards") {
    const naics = arrayString(c.naicsCodes);
    if (naics) parts.push(`NAICS ${naics}`);
    if (c.awardingAgencyName) parts.push(`Agency ${String(c.awardingAgencyName)}`);
    if (c.awardingSubAgencyName) parts.push(`Sub ${String(c.awardingSubAgencyName)}`);
    if (c.keyword) parts.push(`"${String(c.keyword)}"`);
    const sa = arrayString(c.setAsideCodes);
    if (sa) parts.push(`Set-aside ${sa}`);
    if (c.endDateBefore) parts.push(`Ends ≤ ${String(c.endDateBefore)}`);
    if (c.endDateAfter) parts.push(`Ends ≥ ${String(c.endDateAfter)}`);
  } else {
    if (c.naicsPrefix) parts.push(`NAICS ${String(c.naicsPrefix)}*`);
    if (c.state) parts.push(`State ${String(c.state)}`);
    if (c.status && c.status !== "all") parts.push(`Status ${String(c.status)}`);
    if (c.graduatedSinceMonths)
      parts.push(`Graduated ≤ ${String(c.graduatedSinceMonths)}mo ago`);
    if (c.nameKeyword) parts.push(`"${String(c.nameKeyword)}"`);
  }
  return parts.join(" · ");
}

function arrayString(v: unknown): string {
  if (!Array.isArray(v)) return "";
  return v.filter(Boolean).map(String).join(", ");
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}
