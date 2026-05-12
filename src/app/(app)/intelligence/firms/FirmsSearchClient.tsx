"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { downloadCsv } from "@/lib/csv-export";
import {
  saveSavedSearchAction,
  type SavedSearchSaveInput,
} from "../saved-searches/actions";
import {
  listWatchedExternalIdsAction,
  saveWatchlistItemAction,
} from "../watchlist/actions";
import { searchFirmsAction, type FirmRow } from "./actions";

type Status = "all" | "active" | "graduated" | "terminated" | "unknown";

const STATUS_CHOICES: { key: Status; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active 8(a)" },
  { key: "graduated", label: "Graduated" },
  { key: "terminated", label: "Terminated" },
];

export function FirmsSearchClient({
  initialCriteria,
}: {
  initialCriteria: Record<string, unknown> | null;
}) {
  const [status, setStatus] = useState<Status>(
    pickStatus(initialCriteria?.status),
  );
  const [naicsPrefix, setNaicsPrefix] = useState(
    pickStr(initialCriteria?.naicsPrefix),
  );
  const [stateCode, setStateCode] = useState(pickStr(initialCriteria?.state));
  const [graduatedSinceMonths, setGraduatedSinceMonths] = useState<number>(
    pickNum(initialCriteria?.graduatedSinceMonths, 0),
  );
  const [nameKeyword, setNameKeyword] = useState(
    pickStr(initialCriteria?.nameKeyword),
  );

  const [results, setResults] = useState<FirmRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [watchedUeis, setWatchedUeis] = useState<Set<string>>(new Set());

  const [saveSearchOpen, setSaveSearchOpen] = useState(false);
  const [saveSearchName, setSaveSearchName] = useState("");
  const [saveSearchShared, setSaveSearchShared] = useState(false);
  const [saveSearchError, setSaveSearchError] = useState<string | null>(null);
  const [saveSearchTick, setSaveSearchTick] = useState(false);
  const [savingSearch, startSaveSearch] = useTransition();

  // Auto-run when arriving via saved-search deep link.
  useEffect(() => {
    if (initialCriteria) search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function currentCriteria() {
    return {
      status,
      naicsPrefix,
      state: stateCode,
      graduatedSinceMonths,
      nameKeyword,
    };
  }

  function search() {
    setError(null);
    setResults(null);
    startSearch(async () => {
      const res = await searchFirmsAction({
        ...currentCriteria(),
        limit: 100,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResults(res.rows);
      setTotal(res.totalRecords);
      // Light up the star icons for already-watched firms.
      const ueis = res.rows.map((r) => r.uei);
      if (ueis.length) {
        const watched = await listWatchedExternalIdsAction("firm", ueis);
        setWatchedUeis(new Set(watched));
      }
    });
  }

  function toggleWatch(row: FirmRow) {
    if (watchedUeis.has(row.uei)) return;
    setWatchedUeis((prev) => new Set(prev).add(row.uei));
    void (async () => {
      const res = await saveWatchlistItemAction({
        kind: "firm",
        externalId: row.uei,
        label: row.firmName,
        metadata: {
          firmName: row.firmName,
          sba8aStatus: row.status,
          certEntryDate: row.certEntryDate ?? "",
          certExitDate: row.certExitDate ?? "",
          naicsPrimary: row.naicsPrimary,
          city: row.city,
          state: row.state,
        },
      });
      if (!res.ok) {
        setError(res.error);
        setWatchedUeis((prev) => {
          const n = new Set(prev);
          n.delete(row.uei);
          return n;
        });
      }
    })();
  }

  function exportCsv() {
    if (!results) return;
    downloadCsv("firms-8a.csv", results, [
      { header: "UEI", get: (r) => r.uei },
      { header: "Firm", get: (r) => r.firmName },
      { header: "Status", get: (r) => r.status },
      { header: "Cert Entry", get: (r) => r.certEntryDate ?? "" },
      { header: "Cert Exit", get: (r) => r.certExitDate ?? "" },
      { header: "NAICS", get: (r) => r.naicsPrimary },
      { header: "City", get: (r) => r.city },
      { header: "State", get: (r) => r.state },
      { header: "Source", get: (r) => r.source },
    ]);
  }

  function saveCurrentSearch() {
    setSaveSearchError(null);
    const name = saveSearchName.trim();
    if (!name) {
      setSaveSearchError("Name is required.");
      return;
    }
    const input: SavedSearchSaveInput = {
      name,
      kind: "firms",
      criteria: currentCriteria(),
      shared: saveSearchShared,
    };
    startSaveSearch(async () => {
      const res = await saveSavedSearchAction(input);
      if (!res.ok) {
        setSaveSearchError(res.error);
        return;
      }
      setSaveSearchTick(true);
      setSaveSearchOpen(false);
      setSaveSearchName("");
      setSaveSearchShared(false);
      setTimeout(() => setSaveSearchTick(false), 1500);
    });
  }

  const empty = results !== null && results.length === 0;

  return (
    <>
      <Panel title="Search" eyebrow="Filter the 8(a) registry" dense>
        <div className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Status">
            <select
              className="aur-input"
              value={status}
              onChange={(e) => setStatus(e.target.value as Status)}
            >
              {STATUS_CHOICES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="NAICS prefix">
            <input
              className="aur-input"
              placeholder="e.g. 541 (services), 236 (construction)"
              value={naicsPrefix}
              onChange={(e) =>
                setNaicsPrefix(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))
              }
              inputMode="numeric"
            />
          </Field>
          <Field label="State">
            <input
              className="aur-input"
              placeholder="2-letter, e.g. VA"
              maxLength={2}
              value={stateCode}
              onChange={(e) => setStateCode(e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Graduated within (months)">
            <input
              className="aur-input"
              type="number"
              min={0}
              max={120}
              step={1}
              placeholder="0 = no filter"
              value={graduatedSinceMonths || ""}
              onChange={(e) =>
                setGraduatedSinceMonths(
                  Math.max(0, Math.min(120, Number(e.target.value || 0))),
                )
              }
            />
          </Field>
          <Field label="Name contains">
            <input
              className="aur-input"
              placeholder="substring"
              value={nameKeyword}
              onChange={(e) => setNameKeyword(e.target.value)}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-5 py-3">
          <p className="font-mono text-[11px] text-muted">
            Newly graduated firms are <em>especially</em> valuable capture
            targets — they're now competing in full-and-open for the first
            time. Try Status = Graduated, within 24 months.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSaveSearchOpen((v) => !v)}
              className="aur-btn aur-btn-ghost text-[11px]"
            >
              ★ Save search
            </button>
            <button
              type="button"
              onClick={search}
              disabled={searching}
              className="aur-btn aur-btn-primary text-[12px] disabled:opacity-60"
            >
              {searching ? "Searching…" : "Search firms"}
            </button>
          </div>
        </div>
        {saveSearchOpen ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-5 py-3">
            <input
              className="aur-input min-w-[200px] flex-1"
              placeholder="Name this search"
              value={saveSearchName}
              onChange={(e) => setSaveSearchName(e.target.value)}
            />
            <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
              <input
                type="checkbox"
                checked={saveSearchShared}
                onChange={(e) => setSaveSearchShared(e.target.checked)}
              />
              Share with org
            </label>
            <button
              type="button"
              onClick={saveCurrentSearch}
              disabled={savingSearch}
              className="aur-btn aur-btn-primary text-[11px]"
            >
              {savingSearch ? "Saving…" : "Save"}
            </button>
            {saveSearchError ? (
              <span className="font-mono text-[11px] text-rose-300">
                {saveSearchError}
              </span>
            ) : null}
          </div>
        ) : null}
        {saveSearchTick ? (
          <div className="border-t border-emerald-500/20 bg-emerald-500/5 px-5 py-2 font-mono text-[11px] text-emerald-200">
            Saved. View at{" "}
            <a href="/intelligence/saved-searches" className="underline">
              /intelligence/saved-searches
            </a>
            .
          </div>
        ) : null}
      </Panel>

      {error ? (
        <div className="mt-3 rounded border border-rose/30 bg-rose/10 px-3 py-2 font-mono text-[12px] text-rose-200">
          {error}
        </div>
      ) : null}

      {results ? (
        <Panel
          className="mt-3"
          title="Results"
          eyebrow={`${results.length} shown · ${total.toLocaleString()} match`}
          actions={
            <button
              type="button"
              onClick={exportCsv}
              disabled={empty}
              className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-40"
            >
              ⤓ Export CSV
            </button>
          }
          dense
        >
          {empty ? (
            <p className="px-5 py-4 font-mono text-[12px] text-muted">
              No firms match. Try removing a filter, or ask an admin to import
              the SBA 8(a) registry via{" "}
              <a href="/admin/sba-8a" className="underline">
                /admin/sba-8a
              </a>
              .
            </p>
          ) : (
            <ul className="divide-y divide-white/5">
              {results.map((r) => (
                <FirmRowView
                  key={r.uei}
                  row={r}
                  watched={watchedUeis.has(r.uei)}
                  onWatch={() => toggleWatch(r)}
                />
              ))}
            </ul>
          )}
        </Panel>
      ) : null}
    </>
  );
}

function FirmRowView({
  row,
  watched,
  onWatch,
}: {
  row: FirmRow;
  watched: boolean;
  onWatch: () => void;
}) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-display text-[13px] text-text">
            {row.firmName}
          </span>
          {row.status === "graduated" && row.certExitDate ? (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">
              8(a) graduated {row.certExitDate.slice(0, 7)}
            </span>
          ) : row.status === "active" ? (
            <span className="rounded bg-teal-500/15 px-1.5 py-0.5 font-mono text-[10px] text-teal-200">
              8(a) active
            </span>
          ) : row.status === "terminated" ? (
            <span className="rounded bg-rose/15 px-1.5 py-0.5 font-mono text-[10px] text-rose-200">
              8(a) terminated
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted">
          <span>UEI {row.uei}</span>
          {row.naicsPrimary ? <span>NAICS {row.naicsPrimary}</span> : null}
          {row.city || row.state ? (
            <span>
              {row.city}
              {row.city && row.state ? ", " : ""}
              {row.state}
            </span>
          ) : null}
          {row.certEntryDate ? (
            <span>Entered {row.certEntryDate.slice(0, 7)}</span>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        onClick={onWatch}
        disabled={watched}
        className="aur-btn aur-btn-ghost text-[10px] uppercase tracking-[0.18em] disabled:text-emerald-300"
        title={watched ? "Already on watchlist" : "Save to watchlist"}
      >
        {watched ? "★ Saved" : "☆ Save"}
      </button>
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

function pickStatus(v: unknown): Status {
  if (typeof v === "string" && ["all", "active", "graduated", "terminated", "unknown"].includes(v)) {
    return v as Status;
  }
  return "all";
}

function pickStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function pickNum(v: unknown, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}
