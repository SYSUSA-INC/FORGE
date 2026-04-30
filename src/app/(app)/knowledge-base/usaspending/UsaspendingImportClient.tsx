"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import {
  importUsaspendingAwardsAction,
  searchUsaspendingAction,
} from "./actions";
import type { UsaspendingAward } from "@/lib/usaspending";

type Listed = UsaspendingAward & { alreadyImported: boolean };

export function UsaspendingImportClient() {
  const router = useRouter();
  const [recipient, setRecipient] = useState("");
  const [includeIdv, setIncludeIdv] = useState(false);
  const [results, setResults] = useState<Listed[] | null>(null);
  const [total, setTotal] = useState(0);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [importing, startImport] = useTransition();

  // Auto-run a default search using the org name on first mount.
  useEffect(() => {
    let cancelled = false;
    startSearch(async () => {
      const res = await searchUsaspendingAction();
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setRecipient(res.defaultRecipient);
      setResults(res.awards);
      setTotal(res.totalRecords);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function search() {
    setError(null);
    setNotice(null);
    setResults(null);
    setPicked(new Set());
    startSearch(async () => {
      const res = await searchUsaspendingAction({
        recipientName: recipient,
        includeIdv,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResults(res.awards);
      setTotal(res.totalRecords);
    });
  }

  function toggle(id: string) {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function selectAll() {
    if (!results) return;
    setPicked(
      new Set(
        results.filter((r) => !r.alreadyImported).map((r) => r.awardId),
      ),
    );
  }

  function clear() {
    setPicked(new Set());
  }

  function importPicked() {
    if (!results || picked.size === 0) return;
    setError(null);
    setNotice(null);
    const subset = results.filter((r) => picked.has(r.awardId));
    startImport(async () => {
      const res = await importUsaspendingAwardsAction(subset);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(
        `Imported ${res.imported}${res.skipped > 0 ? `, skipped ${res.skipped} duplicates` : ""}.`,
      );
      setPicked(new Set());
      router.refresh();
      search();
    });
  }

  const selectableCount = (results ?? []).filter(
    (r) => !r.alreadyImported,
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Search USAspending"
        eyebrow="Federal contracts (last 7 fiscal years)"
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_auto]">
          <div>
            <label className="aur-label">Recipient name (or UEI)</label>
            <input
              className="aur-input"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  search();
                }
              }}
              placeholder="e.g., Acme Corp · ACME-LLC · ABCD123EFGH7"
            />
            <div className="mt-1 font-mono text-[10px] text-muted">
              Defaults to your org name. Fuzzy match — partial names work.
            </div>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted">
              <input
                type="checkbox"
                className="accent-teal-400"
                checked={includeIdv}
                onChange={(e) => setIncludeIdv(e.target.checked)}
              />
              Include IDV vehicles
            </label>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={search}
              disabled={searching}
              className="aur-btn aur-btn-primary w-full text-[12px] disabled:opacity-60"
            >
              {searching ? "Searching…" : "Search"}
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-3 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="mt-3 rounded-md border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 font-mono text-[11px] text-emerald">
            {notice}
          </div>
        ) : null}
      </Panel>

      {results !== null ? (
        <Panel
          title="Awards"
          eyebrow={`${results.length} shown · ${total.toLocaleString()} total`}
          actions={
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={selectAll}
                disabled={importing || selectableCount === 0}
                className="aur-btn aur-btn-ghost text-[11px]"
              >
                Select all {selectableCount}
              </button>
              <button
                type="button"
                onClick={clear}
                disabled={importing || picked.size === 0}
                className="aur-btn aur-btn-ghost text-[11px]"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={importPicked}
                disabled={importing || picked.size === 0}
                className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
              >
                {importing
                  ? "Importing…"
                  : `Import ${picked.size} selected`}
              </button>
            </div>
          }
        >
          {results.length === 0 ? (
            <div className="font-mono text-[11px] text-muted">
              No awards found. Try a broader recipient name or toggle IDV
              vehicles.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {results.map((a) => (
                <AwardRow
                  key={a.awardId}
                  award={a}
                  picked={picked.has(a.awardId)}
                  onToggle={() => toggle(a.awardId)}
                />
              ))}
            </ul>
          )}
        </Panel>
      ) : null}
    </div>
  );
}

function AwardRow({
  award,
  picked,
  onToggle,
}: {
  award: Listed;
  picked: boolean;
  onToggle: () => void;
}) {
  const period =
    award.startDate && award.endDate
      ? `${award.startDate} → ${award.endDate}`
      : award.startDate || award.endDate || "—";
  return (
    <li
      className={`rounded-lg border p-3 transition-colors ${
        award.alreadyImported
          ? "border-white/10 bg-white/[0.015] opacity-60"
          : picked
            ? "border-teal-400 bg-teal-400/5"
            : "border-white/10 bg-white/[0.02] hover:border-white/20"
      }`}
    >
      <label className="grid cursor-pointer grid-cols-[auto_1fr_auto] items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 accent-teal-400"
          checked={picked}
          disabled={award.alreadyImported}
          onChange={onToggle}
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-display text-[14px] font-semibold text-text">
              {award.awardId}
            </span>
            {award.alreadyImported ? (
              <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted">
                Already imported
              </span>
            ) : null}
            {award.awardType ? (
              <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted">
                {award.awardType}
              </span>
            ) : null}
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            {[award.awardingSubAgency, award.awardingAgency]
              .filter(Boolean)
              .join(" · ") || "—"}
          </div>
          <div className="mt-1 font-mono text-[11px] text-muted">
            <span className="text-text">{award.recipientName}</span>
            {award.naicsCode ? ` · NAICS ${award.naicsCode}` : ""}
            {award.pscCode ? ` · PSC ${award.pscCode}` : ""}
          </div>
          {award.description ? (
            <div className="mt-2 line-clamp-3 font-body text-[12px] text-muted">
              {award.description}
            </div>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          {award.amount ? (
            <div className="font-display text-[14px] font-bold text-text">
              {formatUsd(award.amount)}
            </div>
          ) : null}
          <div className="mt-0.5 font-mono text-[10px] text-muted">{period}</div>
          {award.uiUrl ? (
            <a
              href={award.uiUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="mt-1 inline-block font-mono text-[10px] text-teal hover:underline"
            >
              View on USAspending ↗
            </a>
          ) : null}
        </div>
      </label>
    </li>
  );
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}
