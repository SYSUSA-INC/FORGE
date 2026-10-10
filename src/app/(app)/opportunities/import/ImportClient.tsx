"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { GSA_VEHICLES } from "@/lib/gsa-vehicles";
import {
  NOTICE_TYPES,
  OPEN_NOTICE_TYPES,
  matchNotice,
  noticeAgency,
  parseKeyword,
  searchSummary,
  type KeywordSearchCounts,
  type NoticeTypeCode,
} from "@/lib/samgov-match";
import {
  importSamGovOpportunitiesAction,
  loadSamGovOpportunitiesAction,
  readSamDescriptionsAction,
  type ImportableOpportunity,
} from "./actions";

type Search = {
  counts: KeywordSearchCounts;
  scope: { keyword: string | null; codes: string[]; days: number };
  /** The keyword and vehicle names the results were checked against. */
  query: { keyword: string; anyOf: string[] };
  warning: string | null;
};

export function ImportClient({ defaultNaics, autoSearch }: { defaultNaics: string[]; autoSearch: boolean }) {
  const router = useRouter();
  const [naicsInput, setNaicsInput] = useState(defaultNaics.join(", "));
  const [keyword, setKeyword] = useState("");
  const [postedDaysBack, setPostedDaysBack] = useState(30);
  const [gsaOnly, setGsaOnly] = useState(false);
  const [vehicleIds, setVehicleIds] = useState<Set<string>>(new Set());
  const [noticeTypes, setNoticeTypes] = useState<Set<NoticeTypeCode>>(new Set(OPEN_NOTICE_TYPES));
  const [results, setResults] = useState<ImportableOpportunity[] | null>(null);
  const [unchecked, setUnchecked] = useState<ImportableOpportunity[]>([]);
  const [searchInfo, setSearchInfo] = useState<Search | null>(null);
  const [checking, startChecking] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, startLoading] = useTransition();
  const [importing, startImporting] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (autoSearch && defaultNaics.length > 0 && results === null) {
      search();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function parsedNaics(): string[] {
    return naicsInput
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function search() {
    setError(null);
    setNotice(null);
    setResults(null);
    setUnchecked([]);
    setSearchInfo(null);
    setSelected(new Set());
    const query = {
      keyword: keyword.trim(),
      anyOf: Array.from(vehicleIds).map((id) => GSA_VEHICLES.find((v) => v.id === id)?.keyword ?? "").filter(Boolean),
    };
    startLoading(async () => {
      const res = await loadSamGovOpportunitiesAction({
        naicsCodes: parsedNaics(),
        keyword: query.keyword || undefined,
        postedDaysBack,
        gsaOnly,
        vehicleIds: Array.from(vehicleIds),
        noticeTypes: Array.from(noticeTypes),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResults(res.opportunities);
      setUnchecked(res.unchecked);
      setSearchInfo({ counts: res.counts, scope: res.scope, query, warning: res.warning });
    });
  }

  /** BL-STAB-10 — read 10 more unchecked descriptions and sort them into matches and the rest. */
  function checkMore() {
    if (!searchInfo) return;
    const batch = unchecked.slice(0, 10);
    setError(null);
    startChecking(async () => {
      const res = await readSamDescriptionsAction(batch.map((o) => o.noticeId));
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const q = parseKeyword(searchInfo.query.keyword, searchInfo.query.anyOf);
      const found: ImportableOpportunity[] = [];
      const counts = { ...searchInfo.counts };
      const done = new Set<string>();
      for (const o of batch) {
        const desc = res.descriptions[o.noticeId];
        if (!desc || "unread" in desc) continue;
        done.add(o.noticeId);
        counts.unchecked--;
        const m = matchNotice({ title: o.title, agency: noticeAgency(o) }, q, desc);
        if (m.status === "match") {
          found.push({ ...o, description: "text" in desc ? desc.text : "", match: m });
          counts.matched++;
        } else if (m.status === "no_description") counts.noDescription++;
        else counts.notMentioned++;
      }
      if (done.size === 0) setError("SAM.gov didn't return those descriptions just now. Try again in a few minutes.");
      setResults((prev) => [...(prev ?? []), ...found]);
      setUnchecked((prev) => prev.filter((o) => !done.has(o.noticeId)));
      setSearchInfo({ ...searchInfo, counts });
    });
  }

  function toggleNoticeType(code: NoticeTypeCode) {
    setNoticeTypes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next.size > 0 ? next : prev;
    });
  }

  function toggleVehicle(id: string) {
    setVehicleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (!results) return;
    setSelected(
      new Set(
        results.filter((o) => !o.alreadyImported).map((o) => o.noticeId),
      ),
    );
  }

  function clearSelection() {
    setSelected(new Set());
  }

  function importSelected() {
    setError(null);
    setNotice(null);
    startImporting(async () => {
      // BL-AIP-1 — send the rows the user ticked, exactly as displayed.
      // The server used to re-search SAM.gov for the ids and lose any
      // result outside its default window.
      const picked = [...(results ?? []), ...unchecked].filter((o) => selected.has(o.noticeId));
      const res = await importSamGovOpportunitiesAction(picked);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(
        `Imported ${res.imported} ${res.imported === 1 ? "opportunity" : "opportunities"}${
          res.skipped > 0 ? ` · skipped ${res.skipped} duplicates` : ""
        }.`,
      );
      // Marked here rather than searched again (a search costs SAM.gov requests).
      const imported = (o: ImportableOpportunity) => (selected.has(o.noticeId) ? { ...o, alreadyImported: true } : o);
      setResults((prev) => (prev ?? []).map(imported));
      setUnchecked((prev) => prev.map(imported));
      setSelected(new Set());
      router.refresh();
    });
  }

  const selectableCount = useMemo(
    () => (results ?? []).filter((o) => !o.alreadyImported).length,
    [results],
  );

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Search SAM.gov" eyebrow="Active solicitations">
        <div className="mb-3 rounded-lg border border-layer/10 bg-layer/[0.015] p-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-text">
              <input
                type="checkbox"
                className="accent-teal-400"
                checked={gsaOnly}
                onChange={(e) => setGsaOnly(e.target.checked)}
              />
              GSA-issued only
            </label>
            <div className="font-mono text-[10px] text-muted">
              Restricts to opportunities where GSA is the contracting agency
              (MAS, OASIS+, GWACs, FEDSIM-assisted acquisitions).
            </div>
          </div>
          <div className="mt-3">
            <div className="aur-label">GSA vehicle hint</div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {GSA_VEHICLES.map((v) => {
                const active = vehicleIds.has(v.id);
                return (
                  <button
                    type="button"
                    key={v.id}
                    onClick={() => toggleVehicle(v.id)}
                    title={v.scope}
                    className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest transition-colors ${
                      active
                        ? "border-teal-400 bg-teal-400/15 text-teal"
                        : "border-layer/15 bg-layer/[0.02] text-muted hover:border-layer/30 hover:text-text"
                    }`}
                  >
                    {v.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-1 font-mono text-[10px] text-muted">
              Keeps notices that name one of the picked vehicles. eBuy RFQs aren&rsquo;t
              indexed by SAM.gov &mdash; for those, use{" "}
              <a
                href="/opportunities/import/ebuy"
                className="text-teal hover:underline"
              >
                Paste from eBuy
              </a>
              .
            </div>
          </div>
        </div>
        <div className="mb-3">
          <div className="aur-label">Notice types</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {NOTICE_TYPES.map((t) => {
              const on = noticeTypes.has(t.code);
              return (
                <button
                  type="button"
                  key={t.code}
                  onClick={() => toggleNoticeType(t.code)}
                  aria-pressed={on}
                  className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest transition-colors ${
                    on ? "border-teal-400 bg-teal-400/15 text-teal" : "border-layer/15 bg-layer/[0.02] text-muted hover:border-layer/30 hover:text-text"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
          <div className="mt-1 font-mono text-[10px] text-muted">Open opportunities by default; tick award notices or justifications to include them.</div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto_auto]">
          <div>
            <label className="aur-label">NAICS codes</label>
            <input
              className="aur-input"
              value={naicsInput}
              onChange={(e) => setNaicsInput(e.target.value)}
              placeholder="541512, 541511"
            />
            <div className="mt-1 font-mono text-[10px] text-muted">
              Comma-separated. Defaults to your org&rsquo;s configured NAICS.
            </div>
          </div>
          <div>
            <label className="aur-label">Keyword</label>
            <input
              className="aur-input"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="Optional — e.g., ServiceNow, &quot;zero trust&quot;"
            />
            <div className="mt-1 font-mono text-[10px] text-muted">
              Checked in each notice&rsquo;s title and description. SAM.gov can&rsquo;t search descriptions, so FORGE reads them (one SAM.gov request each, a few per search).
            </div>
          </div>
          <div>
            <label className="aur-label">Posted in last</label>
            <select
              className="aur-input"
              value={postedDaysBack}
              onChange={(e) => setPostedDaysBack(Number(e.target.value))}
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
              <option value={90}>90 days</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              className="aur-btn aur-btn-primary w-full py-2.5 text-sm disabled:opacity-60"
              disabled={loading}
              onClick={search}
            >
              {loading ? "Searching…" : "Search"}
            </button>
          </div>
        </div>
        {error ? (
          <div className="mt-3 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="mt-3 rounded-md border border-emerald/40 bg-emerald/10 px-3 py-2 font-mono text-[11px] text-emerald">
            {notice}
          </div>
        ) : null}
      </Panel>

      {results ? (
        <Panel
          title="Results"
          eyebrow={searchInfo?.scope.keyword ? `${results.length} ${results.length === 1 ? "match" : "matches"}` : `${results.length} shown`}
          actions={
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="aur-btn aur-btn-ghost text-[11px]"
                disabled={importing || selectableCount === 0}
                onClick={selectAll}
              >
                Select all {selectableCount}
              </button>
              <button
                type="button"
                className="aur-btn aur-btn-ghost text-[11px]"
                disabled={importing || selected.size === 0}
                onClick={clearSelection}
              >
                Clear
              </button>
              <button
                type="button"
                className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
                disabled={importing || selected.size === 0}
                onClick={importSelected}
              >
                {importing
                  ? "Importing…"
                  : `Import ${selected.size} selected`}
              </button>
            </div>
          }
        >
          {searchInfo ? (
            <p className="mb-3 font-mono text-[11px] leading-relaxed text-muted">{searchSummary(searchInfo.counts, searchInfo.scope)}</p>
          ) : null}
          {searchInfo?.warning ? <p className="mb-3 font-mono text-[11px] text-gold">{searchInfo.warning}</p> : null}
          {results.length === 0 ? (
            <div className="font-mono text-[11px] text-muted">
              Nothing matches. Try a longer time window, other NAICS codes or notice types, or a different keyword.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {results.map((o) => (
                <OpportunityRow
                  key={o.noticeId}
                  o={o}
                  checked={selected.has(o.noticeId)}
                  onToggle={() => toggleSelected(o.noticeId)}
                />
              ))}
            </ul>
          )}
          {unchecked.length > 0 && searchInfo?.scope.keyword ? (
            <details className="mt-4 rounded-lg border border-layer/10 bg-layer/[0.015] p-3">
              <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-widest text-muted">
                Not checked for “{searchInfo.scope.keyword}” ({unchecked.length})
              </summary>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <p className="font-body text-[12px] text-muted">
                  FORGE hasn&rsquo;t read these descriptions yet, so it can&rsquo;t tell whether they mention it. They aren&rsquo;t counted as matches or picked by Select all.
                </p>
                <button type="button" className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-60" disabled={checking} onClick={checkMore}>
                  {checking ? "Checking…" : `Check ${Math.min(10, unchecked.length)} more (${Math.min(10, unchecked.length)} SAM.gov requests)`}
                </button>
              </div>
              <ul className="mt-3 flex flex-col gap-2">
                {unchecked.map((o) => (
                  <OpportunityRow key={o.noticeId} o={o} checked={selected.has(o.noticeId)} onToggle={() => toggleSelected(o.noticeId)} />
                ))}
              </ul>
            </details>
          ) : null}
        </Panel>
      ) : null}
    </div>
  );
}

function OpportunityRow({
  o,
  checked,
  onToggle,
}: {
  o: ImportableOpportunity;
  checked: boolean;
  onToggle: () => void;
}) {
  const due = o.responseDeadLine
    ? new Date(o.responseDeadLine).toLocaleDateString()
    : null;
  const pop = [
    o.placeOfPerformance?.city?.name,
    o.placeOfPerformance?.state?.name,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <li
      className={`rounded-lg border p-3 transition-colors ${
        o.alreadyImported
          ? "border-layer/10 bg-layer/[0.015] opacity-60"
          : checked
            ? "border-teal-400 bg-teal-400/5"
            : "border-layer/10 bg-layer/[0.02] hover:border-layer/20"
      }`}
    >
      <label className="grid cursor-pointer grid-cols-[auto_1fr_auto] items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 accent-teal-400"
          checked={checked}
          disabled={o.alreadyImported}
          onChange={onToggle}
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-display text-[14px] font-semibold text-text">
              {o.title}
            </span>
            {o.alreadyImported ? (
              <span className="rounded bg-layer/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted">
                Already imported
              </span>
            ) : null}
            {o.recompete ? (
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest ${
                  o.recompete.outcome === "lost"
                    ? "bg-rose/15 text-rose"
                    : "bg-emerald-400/15 text-emerald-300"
                }`}
                title={o.recompete.signals.join(" · ")}
              >
                {o.recompete.confidence === "high" ? "Recompete" : "Possible recompete"} ·{" "}
                {o.recompete.outcome === "lost"
                  ? `lost${o.recompete.awardedTo ? ` to ${o.recompete.awardedTo}` : ""}`
                  : "won"}
                {o.recompete.decidedAt ? ` ${o.recompete.decidedAt.slice(0, 4)}` : ""}
              </span>
            ) : null}
            {o.type ? (
              <span className="rounded bg-layer/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted">
                {o.type}
              </span>
            ) : null}
            {o.match?.status === "match" ? (
              <span className="rounded bg-teal/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-teal">
                {o.match.where === "description" ? "Description match" : o.match.where === "agency" ? "Agency match" : "Title match"}
              </span>
            ) : null}
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            {noticeAgency(o) || "—"}
          </div>
          <div className="mt-1 font-mono text-[11px] text-muted">
            {o.solicitationNumber ? (
              <span className="text-text">{o.solicitationNumber}</span>
            ) : null}
            {o.naicsCode ? ` · NAICS ${o.naicsCode}` : ""}
            {o.typeOfSetAsideDescription
              ? ` · ${o.typeOfSetAsideDescription}`
              : ""}
            {pop ? ` · ${pop}` : ""}
          </div>
          {o.match?.status === "match" && o.match.where === "description" ? (
            <div className="mt-2 rounded-md border border-teal/20 bg-teal/[0.04] px-2.5 py-1.5 font-body text-[12px] text-text">{o.match.snippet}</div>
          ) : o.description ? (
            <div className="mt-2 line-clamp-3 font-body text-[12px] text-muted">
              {o.description.replace(/<[^>]*>/g, "")}
            </div>
          ) : null}
          {o.earlierNoticeIds.length > 0 ? (
            <div className="mt-1 font-mono text-[10px] text-muted">
              Latest of {o.earlierNoticeIds.length + 1} notices for this solicitation (amendments and updates folded in).
            </div>
          ) : null}
          {o.recompete ? (
            <div className="mt-2 rounded-md border border-layer/10 bg-layer/[0.02] px-2.5 py-1.5 font-body text-[12px] text-muted">
              Bid before as{" "}
              <Link
                href={`/proposals/${o.recompete.proposalId}/outcome`}
                onClick={(e) => e.stopPropagation()}
                className="text-text underline"
              >
                {o.recompete.title}
              </Link>
              <span className="font-mono text-[10px] uppercase tracking-widest">
                {" · "}
                {o.recompete.signals.join(" · ")}
              </span>
              {o.recompete.lessons ? (
                <span className="mt-0.5 block line-clamp-2">{o.recompete.lessons}</span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
            Due
          </div>
          <div className="font-mono text-[12px] text-text">{due ?? "—"}</div>
          {o.uiLink ? (
            <a
              href={o.uiLink}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="mt-1 inline-block font-mono text-[10px] text-teal hover:underline"
            >
              View on SAM.gov ↗
            </a>
          ) : null}
        </div>
      </label>
    </li>
  );
}
