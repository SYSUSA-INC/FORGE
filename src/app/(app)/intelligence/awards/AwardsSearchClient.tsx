"use client";

import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { isLikelyRecompete, type UsaspendingAward } from "@/lib/usaspending";
import { searchAwardsIntelAction } from "./actions";

const AWARD_TYPE_CHOICES = [
  { code: "A", label: "BPA Call" },
  { code: "B", label: "Purchase Order" },
  { code: "C", label: "Delivery Order" },
  { code: "D", label: "Definitive Contract" },
];

export function AwardsSearchClient() {
  const [naics, setNaics] = useState("");
  const [agency, setAgency] = useState("");
  const [subAgency, setSubAgency] = useState("");
  const [keyword, setKeyword] = useState("");
  const [endDateBefore, setEndDateBefore] = useState("");
  const [endDateAfter, setEndDateAfter] = useState("");
  const [types, setTypes] = useState<Set<string>>(
    new Set(AWARD_TYPE_CHOICES.map((t) => t.code)),
  );
  const [results, setResults] = useState<UsaspendingAward[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();

  function toggleType(code: string) {
    setTypes((prev) => {
      const n = new Set(prev);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });
  }

  function search() {
    setError(null);
    setResults(null);
    startSearch(async () => {
      const naicsCodes = naics
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await searchAwardsIntelAction({
        naicsCodes,
        awardingAgencyName: agency,
        awardingSubAgencyName: subAgency,
        keyword,
        awardTypeCodes: [...types],
        endDateBefore: endDateBefore || null,
        endDateAfter: endDateAfter || null,
        limit: 100,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResults(res.awards);
      setTotal(res.totalRecords);
    });
  }

  const recompeteCount = (results ?? []).filter((a) => isLikelyRecompete(a))
    .length;

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Filter awards"
        eyebrow="Source: USAspending.gov · last 7 fiscal years"
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="aur-label">NAICS codes</label>
            <input
              className="aur-input"
              value={naics}
              onChange={(e) => setNaics(e.target.value)}
              placeholder="e.g. 541512 541519 (comma- or space-separated)"
            />
          </div>
          <div>
            <label className="aur-label">Keyword (description / PIID)</label>
            <input
              className="aur-input"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="e.g. cybersecurity"
            />
          </div>
          <div>
            <label className="aur-label">Awarding agency (toptier)</label>
            <input
              className="aur-input"
              value={agency}
              onChange={(e) => setAgency(e.target.value)}
              placeholder="e.g. Department of Defense"
            />
          </div>
          <div>
            <label className="aur-label">Sub-agency</label>
            <input
              className="aur-input"
              value={subAgency}
              onChange={(e) => setSubAgency(e.target.value)}
              placeholder="e.g. U.S. Army"
            />
          </div>
          <div>
            <label className="aur-label">End date — on/after</label>
            <input
              type="date"
              className="aur-input"
              value={endDateAfter}
              onChange={(e) => setEndDateAfter(e.target.value)}
            />
          </div>
          <div>
            <label className="aur-label">End date — on/before</label>
            <input
              type="date"
              className="aur-input"
              value={endDateBefore}
              onChange={(e) => setEndDateBefore(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-3">
          <label className="aur-label">Award types</label>
          <div className="flex flex-wrap gap-3">
            {AWARD_TYPE_CHOICES.map((t) => (
              <label
                key={t.code}
                className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted"
              >
                <input
                  type="checkbox"
                  className="accent-teal-400"
                  checked={types.has(t.code)}
                  onChange={() => toggleType(t.code)}
                />
                {t.code} · {t.label}
              </label>
            ))}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end">
          <button
            type="button"
            onClick={search}
            disabled={searching}
            className="aur-btn aur-btn-primary text-[12px] disabled:opacity-60"
          >
            {searching ? "Searching…" : "Search awards"}
          </button>
        </div>

        {error ? (
          <div className="mt-3 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
            {error}
          </div>
        ) : null}
      </Panel>

      {results !== null ? (
        <Panel
          title="Results"
          eyebrow={`${results.length} shown · ${total.toLocaleString()} total · ${recompeteCount} recompete-soon`}
        >
          {results.length === 0 ? (
            <div className="font-mono text-[11px] text-muted">
              No awards matched. Broaden the filter set or extend the end-date
              window.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {results.map((a) => (
                <AwardRow key={a.awardId} award={a} />
              ))}
            </ul>
          )}
        </Panel>
      ) : null}
    </div>
  );
}

function AwardRow({ award }: { award: UsaspendingAward }) {
  const recompete = isLikelyRecompete(award);
  const period =
    award.startDate && award.endDate
      ? `${award.startDate} → ${award.endDate}`
      : award.startDate || award.endDate || "—";
  return (
    <li
      className={`rounded-lg border p-3 transition-colors ${
        recompete
          ? "border-amber-400/60 bg-amber-400/5"
          : "border-white/10 bg-white/[0.02] hover:border-white/20"
      }`}
    >
      <div className="grid grid-cols-[1fr_auto] items-start gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-display text-[14px] font-semibold text-text">
              {award.awardId}
            </span>
            {recompete ? (
              <span className="rounded bg-amber-400/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-amber-300">
                Recompete soon
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
              className="mt-1 inline-block font-mono text-[10px] text-teal hover:underline"
            >
              View on USAspending ↗
            </a>
          ) : null}
        </div>
      </div>
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
