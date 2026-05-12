"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { downloadCsv } from "@/lib/csv-export";
import {
  isLikelyRecompete,
  setAsideLabel,
  SET_ASIDE_GROUPS,
  type SetAsideGroupKey,
  type UsaspendingAward,
} from "@/lib/usaspending";
import { normalizeFirmName } from "@/lib/sba-8a";
import {
  lookupSba8aChipsAction,
  searchAwardsIntelAction,
  type Sba8aChipWire,
} from "./actions";
import {
  saveSavedSearchAction,
  type SavedSearchSaveInput,
} from "../saved-searches/actions";
import {
  listWatchedExternalIdsAction,
  saveWatchlistItemAction,
} from "../watchlist/actions";

const AWARD_TYPE_CHOICES = [
  { code: "A", label: "BPA Call" },
  { code: "B", label: "Purchase Order" },
  { code: "C", label: "Delivery Order" },
  { code: "D", label: "Definitive Contract" },
];

type SortKey =
  | "amount_desc"
  | "amount_asc"
  | "end_asc"
  | "end_desc"
  | "agency_asc";

const SORT_CHOICES: { key: SortKey; label: string }[] = [
  { key: "amount_desc", label: "Amount $ (high → low)" },
  { key: "amount_asc", label: "Amount $ (low → high)" },
  { key: "end_asc", label: "End date (soonest → latest)" },
  { key: "end_desc", label: "End date (latest → soonest)" },
  { key: "agency_asc", label: "Agency (A–Z)" },
];

export function AwardsSearchClient({
  initialCriteria,
}: {
  initialCriteria?: Record<string, unknown> | null;
}) {
  // Search-form (server-side) state.
  const [naics, setNaics] = useState(arrayToInput(initialCriteria?.naicsCodes));
  const [agency, setAgency] = useState(
    pickStr(initialCriteria?.awardingAgencyName),
  );
  const [subAgency, setSubAgency] = useState(
    pickStr(initialCriteria?.awardingSubAgencyName),
  );
  const [keyword, setKeyword] = useState(pickStr(initialCriteria?.keyword));
  const [endDateBefore, setEndDateBefore] = useState(
    pickStr(initialCriteria?.endDateBefore),
  );
  const [endDateAfter, setEndDateAfter] = useState(
    pickStr(initialCriteria?.endDateAfter),
  );
  const [types, setTypes] = useState<Set<string>>(
    initialCriteria?.awardTypeCodes &&
      Array.isArray(initialCriteria.awardTypeCodes) &&
      (initialCriteria.awardTypeCodes as unknown[]).length > 0
      ? new Set(
          (initialCriteria.awardTypeCodes as string[]).filter(
            (c): c is string => typeof c === "string",
          ),
        )
      : new Set(AWARD_TYPE_CHOICES.map((t) => t.code)),
  );
  const [setAsideGroups, setSetAsideGroups] = useState<Set<SetAsideGroupKey>>(
    hydrateSetAsideGroups(initialCriteria?.setAsideCodes),
  );

  // Result-list state.
  const [results, setResults] = useState<UsaspendingAward[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();

  // Client-side controls applied to the rendered result list.
  const [sortKey, setSortKey] = useState<SortKey>("amount_desc");
  const [resultAgencyFilter, setResultAgencyFilter] = useState("");
  const [recompeteOnly, setRecompeteOnly] = useState(false);

  // BD intel additions: watchlist + 8(a) chip + save-search.
  const [watchedAwardIds, setWatchedAwardIds] = useState<Set<string>>(new Set());
  const [sba8aIndex, setSba8aIndex] = useState<Map<string, Sba8aChipWire>>(
    new Map(),
  );
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

  function toggleType(code: string) {
    setTypes((prev) => {
      const n = new Set(prev);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });
  }

  function toggleSetAside(key: SetAsideGroupKey) {
    setSetAsideGroups((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  function buildCriteria() {
    const naicsCodes = naics
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const setAsideCodes = SET_ASIDE_GROUPS.filter((g) =>
      setAsideGroups.has(g.key),
    ).flatMap((g) => g.codes as readonly string[]);
    return {
      naicsCodes,
      awardingAgencyName: agency,
      awardingSubAgencyName: subAgency,
      keyword,
      awardTypeCodes: [...types],
      setAsideCodes,
      endDateBefore: endDateBefore || null,
      endDateAfter: endDateAfter || null,
    };
  }

  function search() {
    setError(null);
    setResults(null);
    setResultAgencyFilter("");
    setRecompeteOnly(false);
    setWatchedAwardIds(new Set());
    setSba8aIndex(new Map());
    startSearch(async () => {
      const res = await searchAwardsIntelAction({
        ...buildCriteria(),
        limit: 100,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResults(res.awards);
      setTotal(res.totalRecords);

      // Fire watchlist + 8(a) lookups in parallel — they're decorative
      // so they shouldn't block the primary result render.
      const awardIds = res.awards
        .map((a) => internalIdFromAward(a))
        .filter(Boolean);
      const recipients = res.awards.map((a) => ({
        uei: a.recipientUei,
        name: a.recipientName,
      }));

      const [watched, chips] = await Promise.all([
        awardIds.length
          ? listWatchedExternalIdsAction("award", awardIds)
          : Promise.resolve([] as string[]),
        recipients.length
          ? lookupSba8aChipsAction(recipients)
          : Promise.resolve([] as Sba8aChipWire[]),
      ]);
      setWatchedAwardIds(new Set(watched));
      setSba8aIndex(new Map(chips.map((c) => [c.key, c])));
    });
  }

  function chipFor(award: UsaspendingAward): Sba8aChipWire | undefined {
    const key =
      (award.recipientUei || "").toUpperCase().trim() ||
      normalizeFirmName(award.recipientName || "");
    return sba8aIndex.get(key);
  }

  function toggleWatch(award: UsaspendingAward) {
    const id = internalIdFromAward(award);
    if (!id || watchedAwardIds.has(id)) return;
    setWatchedAwardIds((prev) => new Set(prev).add(id));
    const chip = chipFor(award);
    void (async () => {
      const res = await saveWatchlistItemAction({
        kind: "award",
        externalId: id,
        label: `${award.recipientName || "—"} · ${award.awardId}`,
        metadata: {
          awardId: award.awardId,
          recipientName: award.recipientName,
          amount: award.amount,
          awardingAgency: award.awardingAgency,
          awardingSubAgency: award.awardingSubAgency,
          endDate: award.endDate ?? "",
          naicsCode: award.naicsCode,
          setAsideCode: award.setAsideCode,
          sba8aStatus: chip?.status ?? "",
        },
      });
      if (!res.ok) {
        setError(res.error);
        setWatchedAwardIds((prev) => {
          const n = new Set(prev);
          n.delete(id);
          return n;
        });
      }
    })();
  }

  function exportCsv() {
    if (!results) return;
    const list = filteredResults ?? results;
    downloadCsv("awards.csv", list, [
      { header: "Award ID", get: (a) => a.awardId },
      { header: "Recipient", get: (a) => a.recipientName },
      { header: "UEI", get: (a) => a.recipientUei },
      { header: "Amount", get: (a) => a.amount },
      { header: "Awarding Agency", get: (a) => a.awardingAgency },
      { header: "Sub-Agency", get: (a) => a.awardingSubAgency },
      { header: "Type", get: (a) => a.awardType },
      { header: "Start Date", get: (a) => a.startDate ?? "" },
      { header: "End Date", get: (a) => a.endDate ?? "" },
      { header: "NAICS", get: (a) => a.naicsCode },
      { header: "PSC", get: (a) => a.pscCode },
      { header: "Set-Aside", get: (a) => setAsideLabel(a.setAsideCode) },
      { header: "8(a) Status", get: (a) => chipFor(a)?.status ?? "" },
      {
        header: "8(a) Exit Date",
        get: (a) => chipFor(a)?.certExitDate ?? "",
      },
      { header: "USAspending URL", get: (a) => a.uiUrl },
      { header: "Description", get: (a) => a.description },
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
      kind: "awards",
      criteria: buildCriteria(),
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

  const agenciesInResults = useMemo(() => {
    if (!results) return [] as string[];
    const seen = new Set<string>();
    for (const r of results) {
      const a = r.awardingAgency;
      if (a && !seen.has(a)) seen.add(a);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [results]);

  const filteredResults = useMemo(() => {
    if (!results) return null;
    let list = results;
    if (resultAgencyFilter) {
      list = list.filter((r) => r.awardingAgency === resultAgencyFilter);
    }
    if (recompeteOnly) {
      list = list.filter((r) => isLikelyRecompete(r));
    }
    const sorted = [...list];
    switch (sortKey) {
      case "amount_desc":
        sorted.sort((a, b) => b.amount - a.amount);
        break;
      case "amount_asc":
        sorted.sort((a, b) => a.amount - b.amount);
        break;
      case "end_asc":
        sorted.sort((a, b) => {
          // null end dates pushed to the bottom of "soonest first"
          const av = a.endDate ?? "9999-12-31";
          const bv = b.endDate ?? "9999-12-31";
          return av.localeCompare(bv);
        });
        break;
      case "end_desc":
        sorted.sort((a, b) => {
          const av = a.endDate ?? "";
          const bv = b.endDate ?? "";
          return bv.localeCompare(av);
        });
        break;
      case "agency_asc":
        sorted.sort((a, b) =>
          (a.awardingAgency || "").localeCompare(b.awardingAgency || ""),
        );
        break;
    }
    return sorted;
  }, [results, resultAgencyFilter, recompeteOnly, sortKey]);

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

        <div className="mt-3">
          <label className="aur-label">
            Socio-economic set-aside
            <span className="ml-1 font-mono text-[9px] uppercase tracking-widest text-muted/60">
              (leave empty for full + open)
            </span>
          </label>
          <div className="flex flex-wrap gap-3">
            {SET_ASIDE_GROUPS.map((g) => (
              <label
                key={g.key}
                className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted"
              >
                <input
                  type="checkbox"
                  className="accent-teal-400"
                  checked={setAsideGroups.has(g.key)}
                  onChange={() => toggleSetAside(g.key)}
                />
                {g.label}
              </label>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
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
            {searching ? "Searching…" : "Search awards"}
          </button>
        </div>

        {saveSearchOpen ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-white/10 bg-white/[0.02] px-3 py-2">
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
          <div className="mt-3 rounded border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 font-mono text-[11px] text-emerald-200">
            Saved. View at{" "}
            <a href="/intelligence/saved-searches" className="underline">
              /intelligence/saved-searches
            </a>
            .
          </div>
        ) : null}

        {error ? (
          <div className="mt-3 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
            {error}
          </div>
        ) : null}
      </Panel>

      {results !== null && filteredResults !== null ? (
        <Panel
          title="Results"
          eyebrow={`${filteredResults.length} shown · ${total.toLocaleString()} total · ${recompeteCount} recompete-soon`}
          actions={
            <button
              type="button"
              onClick={exportCsv}
              disabled={filteredResults.length === 0}
              className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-40"
            >
              ⤓ Export CSV
            </button>
          }
        >
          <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="aur-label">Sort</label>
              <select
                className="aur-input"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
              >
                {SORT_CHOICES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="aur-label">Filter by agency</label>
              <select
                className="aur-input"
                value={resultAgencyFilter}
                onChange={(e) => setResultAgencyFilter(e.target.value)}
              >
                <option value="">All agencies in results</option>
                {agenciesInResults.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-muted">
                <input
                  type="checkbox"
                  className="accent-amber-400"
                  checked={recompeteOnly}
                  onChange={(e) => setRecompeteOnly(e.target.checked)}
                />
                Recompete-soon only
              </label>
            </div>
          </div>

          {filteredResults.length === 0 ? (
            <div className="font-mono text-[11px] text-muted">
              {results.length === 0
                ? "No awards matched. Broaden the filter set or extend the end-date window."
                : "Result-side filters hide every award. Clear them above."}
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {filteredResults.map((a) => {
                const internalId = internalIdFromAward(a);
                return (
                  <AwardRow
                    key={a.awardId}
                    award={a}
                    chip={chipFor(a)}
                    watched={
                      internalId ? watchedAwardIds.has(internalId) : false
                    }
                    canWatch={!!internalId}
                    onWatch={() => toggleWatch(a)}
                  />
                );
              })}
            </ul>
          )}
        </Panel>
      ) : null}
    </div>
  );
}

function AwardRow({
  award,
  chip,
  watched,
  canWatch,
  onWatch,
}: {
  award: UsaspendingAward;
  chip: Sba8aChipWire | undefined;
  watched: boolean;
  canWatch: boolean;
  onWatch: () => void;
}) {
  const recompete = isLikelyRecompete(award);
  const period =
    award.startDate && award.endDate
      ? `${award.startDate} → ${award.endDate}`
      : award.startDate || award.endDate || "—";
  const setAside = setAsideLabel(award.setAsideCode);
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
            {setAside ? (
              <span className="rounded bg-teal-400/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-teal">
                {setAside}
              </span>
            ) : null}
            {chip ? (
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${
                  chip.status === "graduated"
                    ? "bg-amber-500/15 text-amber-200"
                    : chip.status === "active"
                      ? "bg-teal-500/15 text-teal-200"
                      : "bg-white/5 text-muted"
                }`}
                title={
                  chip.matchedBy === "name"
                    ? "8(a) match via firm name (no UEI available)"
                    : "8(a) match via UEI"
                }
              >
                8(a) {chip.status}
                {chip.certExitDate ? ` · ${chip.certExitDate.slice(0, 7)}` : ""}
                {chip.matchedBy === "name" ? " ~" : ""}
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
          {canWatch ? (
            <div className="mt-1">
              <button
                type="button"
                onClick={onWatch}
                disabled={watched}
                className="aur-btn aur-btn-ghost text-[10px] uppercase tracking-[0.18em] disabled:text-emerald-300"
                title={watched ? "Already on watchlist" : "Save to watchlist"}
              >
                {watched ? "★ Saved" : "☆ Save"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/**
 * Extract the USAspending generated_internal_id from a normalised
 * award's uiUrl. We use that as the stable watchlist key — it survives
 * piid renames and is what USAspending uses as the deeplink primary
 * key. Returns "" when uiUrl is missing/unparseable.
 */
function internalIdFromAward(a: UsaspendingAward): string {
  if (!a.uiUrl) return "";
  const m = a.uiUrl.match(/\/award\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

function pickStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function arrayToInput(v: unknown): string {
  if (!Array.isArray(v)) return "";
  return v
    .filter((x): x is string => typeof x === "string")
    .join(" ")
    .trim();
}

function hydrateSetAsideGroups(v: unknown): Set<SetAsideGroupKey> {
  if (!Array.isArray(v)) return new Set();
  const codes = new Set(
    v
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.toUpperCase()),
  );
  const out = new Set<SetAsideGroupKey>();
  for (const g of SET_ASIDE_GROUPS) {
    if ((g.codes as readonly string[]).some((c) => codes.has(c))) {
      out.add(g.key);
    }
  }
  return out;
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}
