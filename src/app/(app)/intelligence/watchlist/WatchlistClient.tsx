"use client";

import { useMemo, useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { downloadCsv } from "@/lib/csv-export";
import {
  removeWatchlistItemAction,
  updateWatchlistNotesAction,
  type WatchlistRow,
} from "./actions";

type Tab = "awards" | "firms";

export function WatchlistClient({ rows }: { rows: WatchlistRow[] }) {
  const [tab, setTab] = useState<Tab>("awards");
  const [items, setItems] = useState<WatchlistRow[]>(rows);
  const [error, setError] = useState<string | null>(null);

  const awards = useMemo(() => items.filter((r) => r.kind === "award"), [items]);
  const firms = useMemo(() => items.filter((r) => r.kind === "firm"), [items]);
  const current = tab === "awards" ? awards : firms;

  function remove(id: string) {
    setItems((prev) => prev.filter((r) => r.id !== id));
    setError(null);
    void (async () => {
      const res = await removeWatchlistItemAction(id);
      if (!res.ok) setError(res.error);
    })();
  }

  function exportCsv() {
    if (tab === "awards") {
      downloadCsv("watchlist-awards.csv", awards, [
        { header: "Award ID", get: (r) => meta(r, "awardId") },
        { header: "Recipient", get: (r) => r.label },
        { header: "Amount", get: (r) => fmtMoney(meta(r, "amount")) },
        { header: "Agency", get: (r) => meta(r, "awardingAgency") },
        { header: "End Date", get: (r) => meta(r, "endDate") },
        { header: "NAICS", get: (r) => meta(r, "naicsCode") },
        { header: "Set-Aside", get: (r) => meta(r, "setAsideCode") },
        { header: "8(a) Status", get: (r) => meta(r, "sba8aStatus") },
        { header: "Notes", get: (r) => r.notes },
      ]);
    } else {
      downloadCsv("watchlist-firms.csv", firms, [
        { header: "UEI", get: (r) => r.externalId },
        { header: "Firm", get: (r) => r.label },
        { header: "8(a) Status", get: (r) => meta(r, "sba8aStatus") },
        { header: "Exit Date", get: (r) => meta(r, "certExitDate") },
        { header: "City", get: (r) => meta(r, "city") },
        { header: "State", get: (r) => meta(r, "state") },
        { header: "NAICS", get: (r) => meta(r, "naicsPrimary") },
        { header: "Notes", get: (r) => r.notes },
      ]);
    }
  }

  return (
    <>
      {error ? (
        <div className="mb-3 rounded border border-rose/30 bg-rose/10 px-3 py-2 font-mono text-[12px] text-rose-200">
          {error}
        </div>
      ) : null}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 border-b border-white/10">
          <TabButton
            label={`Awards · ${awards.length}`}
            active={tab === "awards"}
            onClick={() => setTab("awards")}
          />
          <TabButton
            label={`Firms · ${firms.length}`}
            active={tab === "firms"}
            onClick={() => setTab("firms")}
          />
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={current.length === 0}
          className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-40"
        >
          ⤓ Export CSV
        </button>
      </div>

      <Panel
        title={tab === "awards" ? "Watched awards" : "Watched firms"}
        eyebrow={`${current.length} pinned`}
        dense
      >
        {current.length === 0 ? (
          <p className="px-5 py-4 font-mono text-[12px] text-muted">
            Nothing pinned yet. Star awards from{" "}
            <a href="/intelligence/awards" className="underline">
              /intelligence/awards
            </a>{" "}
            {tab === "firms" ? (
              <>
                or firms from{" "}
                <a href="/intelligence/firms" className="underline">
                  /intelligence/firms
                </a>{" "}
              </>
            ) : null}
            to add them here.
          </p>
        ) : (
          <ul className="divide-y divide-white/5">
            {current.map((r) => (
              <WatchlistRowView key={r.id} row={r} onRemove={() => remove(r.id)} />
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function WatchlistRowView({
  row,
  onRemove,
}: {
  row: WatchlistRow;
  onRemove: () => void;
}) {
  const [notes, setNotes] = useState(row.notes);
  const [saving, startSave] = useTransition();
  const [savedTick, setSavedTick] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  function saveNotes() {
    startSave(async () => {
      const res = await updateWatchlistNotesAction(row.id, notes);
      if (res.ok) {
        setSavedTick(true);
        setTimeout(() => setSavedTick(false), 1200);
      } else {
        setRemoveError(res.error);
      }
    });
  }

  const url =
    row.kind === "award"
      ? `https://www.usaspending.gov/award/${encodeURIComponent(row.externalId)}`
      : null;

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[13px] text-text">
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {row.label || row.externalId}
              </a>
            ) : (
              row.label || row.externalId
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted">
            <MetaSummary row={row} />
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="aur-btn aur-btn-ghost text-[10px] uppercase tracking-[0.18em] text-rose-300 hover:text-rose-200"
        >
          Remove
        </button>
      </div>
      {removeError ? (
        <div className="mt-2 font-mono text-[11px] text-rose-300">{removeError}</div>
      ) : null}
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== row.notes) saveNotes();
          }}
          placeholder="Notes (capture context, next steps, contacts…)"
          rows={2}
          className="aur-input min-w-0 flex-1 resize-none font-mono text-[11px]"
        />
        <div className="font-mono text-[10px] text-muted">
          {saving ? "Saving…" : savedTick ? "Saved ✓" : ""}
        </div>
      </div>
    </li>
  );
}

function MetaSummary({ row }: { row: WatchlistRow }) {
  const m = row.metadata;
  if (row.kind === "award") {
    return (
      <>
        {meta(row, "awardingAgency") ? (
          <span>{meta(row, "awardingAgency")}</span>
        ) : null}
        {meta(row, "amount") ? <span>${fmtMoney(m.amount)}</span> : null}
        {meta(row, "endDate") ? <span>Ends {meta(row, "endDate")}</span> : null}
        {meta(row, "naicsCode") ? (
          <span>NAICS {meta(row, "naicsCode")}</span>
        ) : null}
        {meta(row, "sba8aStatus") ? (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-200">
            8(a) {meta(row, "sba8aStatus")}
          </span>
        ) : null}
      </>
    );
  }
  return (
    <>
      <span>UEI {row.externalId}</span>
      {meta(row, "city") || meta(row, "state") ? (
        <span>
          {meta(row, "city")}
          {meta(row, "city") && meta(row, "state") ? ", " : ""}
          {meta(row, "state")}
        </span>
      ) : null}
      {meta(row, "naicsPrimary") ? (
        <span>NAICS {meta(row, "naicsPrimary")}</span>
      ) : null}
      {meta(row, "sba8aStatus") ? (
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-200">
          8(a) {meta(row, "sba8aStatus")}
          {meta(row, "certExitDate") ? ` · ${meta(row, "certExitDate")}` : ""}
        </span>
      ) : null}
    </>
  );
}

function TabButton({
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
      className={`-mb-px border-b-2 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.22em] transition-colors ${
        active
          ? "border-teal-400 text-text"
          : "border-transparent text-muted hover:text-text"
      }`}
    >
      {label}
    </button>
  );
}

function meta(row: WatchlistRow, key: string): string {
  const v = row.metadata[key];
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

function fmtMoney(v: unknown): string {
  const n =
    typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
