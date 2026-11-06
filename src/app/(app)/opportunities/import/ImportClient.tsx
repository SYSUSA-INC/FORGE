"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ResultHead, ResultRow } from "@/components/scout/ResultRow";
import { Panel } from "@/components/ui/Panel";
import { GSA_VEHICLES } from "@/lib/gsa-vehicles";
import { MAX_IMPORT_ROWS } from "@/lib/sam-import-row";
import {
  NOTICE_TYPES,
  OPEN_NOTICE_TYPES,
  describeKeyword,
  noticeAgency,
  parseKeyword,
  plainText,
  searchSummary,
  withEarlierHit,
  type KeywordSearchCounts,
  type NoticeTypeCode,
} from "@/lib/samgov-match";
import {
  importSamGovOpportunitiesAction,
  loadSamGovOpportunitiesAction,
  readSamDescriptionsAction,
  type ImportableOpportunity,
} from "./actions";

/** BL-STAB-10 — a search's counts and scope, and the keyword and vehicle names its results were checked against. */
type Search = { counts: KeywordSearchCounts; scope: { keyword: string | null; codes: string[]; days: number; copyThrough: string | null }; query: { keyword: string; anyOf: string[] }; warning: string | null };

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
  // BL-STAB-10b — how FORGE reads the keyword, as it is typed.
  const keywordQuery = useMemo(() => parseKeyword(keyword), [keyword]);
  const keywordReading = describeKeyword(keywordQuery);
  const keywordNotes = keywordQuery.notes;
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
      }).catch(() => ({ ok: false as const, error: "The search didn't finish. SAM.gov may be slow: try fewer NAICS codes or a shorter window." }));
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
      const res = await readSamDescriptionsAction(batch.map((o) => o.noticeId)).catch(() => ({ ok: false as const, error: "The check didn't finish. Try again in a minute." }));
      if (!res.ok) return setError(res.error);
      const q = parseKeyword(searchInfo.query.keyword, searchInfo.query.anyOf);
      const found: ImportableOpportunity[] = [];
      const counts = { ...searchInfo.counts };
      const done = new Set<string>();
      for (const o of batch) {
        const desc = res.descriptions[o.noticeId];
        if (!desc || "unread" in desc) continue;
        const m = withEarlierHit({ title: o.title, agency: noticeAgency(o) }, q, desc, o.earlierMatch);
        // Only the start of the text, with no hit: still not checked.
        if (m.status === "unchecked") continue;
        done.add(o.noticeId);
        counts.unchecked--;
        if (o.afterCopy && counts.uncheckedNew) counts.uncheckedNew--;
        if (m.status === "match") {
          // Only whole text travels with the row; the import reads the rest of a partial one.
          found.push({ ...o, description: "text" in desc && !desc.partial ? desc.text : "", match: m });
          counts.matched++;
        } else if (m.status === "no_description") counts.noDescription++;
        else counts.notMentioned++;
      }
      if (done.size === 0) setError("SAM.gov didn't return those descriptions just now. Try again in a few minutes.");
      setResults((prev) => [...(prev ?? []), ...found]);
      setUnchecked((prev) => prev.filter((o) => !done.has(o.noticeId)));
      // A ticked notice the check ruled out isn't a pick any more.
      const kept = new Set(found.map((o) => o.noticeId));
      setSelected((prev) => new Set([...prev].filter((id) => !done.has(id) || kept.has(id))));
      setSearchInfo({ ...searchInfo, counts });
    });
  }

  function toggleNoticeType(code: NoticeTypeCode) {
    setNoticeTypes((prev) => {
      const next = new Set(prev);
      if (!next.delete(code)) next.add(code);
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
    // BL-AIP-1 — send the rows the user ticked, exactly as displayed.
    // The server used to re-search SAM.gov for the ids and lose any
    // result outside its default window.
    // The server imports at most MAX_IMPORT_ROWS a time: send (and mark) just those.
    const picked = [...(results ?? []), ...unchecked].filter((o) => selected.has(o.noticeId)).slice(0, MAX_IMPORT_ROWS);
    addToPipeline(picked, selected.size);
  }

  /** BL-NAV-LIFECYCLE 1b — the button beside each notice: that one row, now. */
  function addOne(o: ImportableOpportunity) {
    addToPipeline([o], 1);
  }

  function addToPipeline(picked: ImportableOpportunity[], wanted: number) {
    setError(null);
    setNotice(null);
    startImporting(async () => {
      const sent = new Set(picked.map((o) => o.noticeId));
      const res = await importSamGovOpportunitiesAction(picked);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(
        `Added ${res.imported} ${res.imported === 1 ? "opportunity" : "opportunities"} to the pipeline${
          res.skipped > 0 ? ` · skipped ${res.skipped} already there` : ""
        }${wanted > sent.size ? ` · add again for the other ${wanted - sent.size} (${MAX_IMPORT_ROWS} at a time)` : ""}.`,
      );
      // Marked here rather than searched again (a search costs SAM.gov requests).
      const imported = (o: ImportableOpportunity) => (sent.has(o.noticeId) ? { ...o, alreadyImported: true } : o);
      setResults((prev) => (prev ?? []).map(imported));
      setUnchecked((prev) => prev.map(imported));
      setSelected((prev) => new Set([...prev].filter((id) => !sent.has(id))));
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
            {NOTICE_TYPES.map((t) => (
              <button
                type="button"
                key={t.code}
                onClick={() => toggleNoticeType(t.code)}
                aria-pressed={noticeTypes.has(t.code)}
                className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest transition-colors ${noticeTypes.has(t.code) ? "border-teal-400 bg-teal-400/15 text-teal" : "border-layer/15 bg-layer/[0.02] text-muted hover:border-layer/30 hover:text-text"}`}
              >
                {t.label}
              </button>
            ))}
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
              placeholder="Optional — e.g., ServiceNow, ITSM, Enterprise Service Management"
            />
            <div className="mt-1 font-mono text-[10px] text-muted">
              {keywordReading ? <span className="text-text">{keywordReading}. </span> : null}
              Commas separate alternatives (any of them); words without commas must all appear; &quot;quotes&quot; keep a phrase; -word excludes. Checked in each notice&rsquo;s title and description.
            </div>
            {keywordNotes.map((n) => (
              <div key={n} className="mt-1 font-mono text-[10px] text-gold">{n}</div>
            ))}
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
              disabled={loading || checking}
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
                  ? "Adding…"
                  : `Add ${selected.size} selected to pipeline`}
              </button>
            </div>
          }
        >
          {searchInfo ? <p className="mb-3 font-mono text-[11px] leading-relaxed text-muted">{searchSummary(searchInfo.counts, searchInfo.scope)}</p> : null}
          {searchInfo?.warning ? <p className="mb-3 font-mono text-[11px] text-gold">{searchInfo.warning}</p> : null}
          {results.length === 0 ? (
            <div className="font-mono text-[11px] text-muted">
              Nothing matches. Try a longer time window, other NAICS codes or notice types, or a different keyword.
            </div>
          ) : (
            <>
            <ResultHead select />
            <ul>
              {results.map((o) => (
                <OpportunityRow
                  key={o.noticeId}
                  o={o}
                  checked={selected.has(o.noticeId)}
                  onToggle={() => toggleSelected(o.noticeId)}
                  onAdd={() => addOne(o)}
                  busy={importing}
                />
              ))}
            </ul>
            </>
          )}
          {unchecked.length > 0 && searchInfo?.scope.keyword ? (
            <details className="mt-4 rounded-lg border border-layer/10 bg-layer/[0.015] p-3">
              <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-widest text-muted">Not checked for {searchInfo.scope.keyword} ({unchecked.length})</summary>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <p className="font-body text-[12px] text-muted">FORGE hasn&rsquo;t read these descriptions yet, so it can&rsquo;t tell whether they mention it. They aren&rsquo;t counted as matches or picked by Select all.</p>
                <button type="button" className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-60" disabled={checking} onClick={checkMore}>
                  {checking ? "Checking…" : `Check ${Math.min(10, unchecked.length)} more (${Math.min(10, unchecked.length)} SAM.gov requests)`}
                </button>
              </div>
              <ul className="mt-3">
                {unchecked.map((o) => <OpportunityRow key={o.noticeId} o={o} checked={selected.has(o.noticeId)} onToggle={() => toggleSelected(o.noticeId)} onAdd={() => addOne(o)} busy={importing} />)}
              </ul>
            </details>
          ) : null}
        </Panel>
      ) : null}
    </div>
  );
}

/**
 * BL-SCOUT-ONEPAGE — a SAM.gov search result in the Scout's shared row:
 * no AI call (a live search isn't reviewed), the matched keywords and
 * codes, a recompete flag and the description open below; Add to
 * pipeline on the row, a box to add several at once.
 */
function OpportunityRow({
  o,
  checked,
  onToggle,
  onAdd,
  busy,
}: {
  o: ImportableOpportunity;
  checked: boolean;
  onToggle: () => void;
  /** BL-NAV-LIFECYCLE 1b — add this one notice to the pipeline. */
  onAdd: () => void;
  busy: boolean;
}) {
  const days = o.responseDeadLine ? Math.ceil((new Date(o.responseDeadLine).getTime() - Date.now()) / 86_400_000) : null;
  const pop = [o.placeOfPerformance?.city?.name, o.placeOfPerformance?.state?.name].filter(Boolean).join(", ");
  return (
    <ResultRow
      call={o.recompete ? { label: "Recompete", tone: o.recompete.outcome === "lost" ? "skip" : "pursue", title: o.recompete.signals.join(" · ") } : { label: "Search", tone: "none", title: "A live search result: the AI reviews the scout's finds, not searches" }}
      title={o.title}
      href={o.uiLink || null}
      meta={[noticeAgency(o), o.type, o.solicitationNumber, o.naicsCode ? `NAICS ${o.naicsCode}` : "", o.typeOfSetAsideDescription, pop].filter(Boolean).join(" · ")}
      source="SAM.gov"
      due={days === null ? null : days < 0 ? `${-days}d ago` : `${days}d`}
      dueSoon={days !== null && days < 5}
      fit={null}
      muted={o.alreadyImported}
      select={{ checked, disabled: o.alreadyImported, onToggle }}
      badges={o.alreadyImported ? <span className="rounded bg-layer/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-muted">In the pipeline</span> : null}
      details={
        <div className="flex flex-col gap-2">
          {o.match?.status === "match" || o.viaCodes.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {o.match?.status === "match"
                ? o.match.matched.map((m) => (
                    <span key={`${m.term}|${m.where}`} className="rounded bg-cobalt/10 px-1.5 py-0.5 font-mono text-[10px] text-text">
                      {m.term} · {m.where}
                    </span>
                  ))
                : null}
              {o.viaCodes.map((c) => (
                <span key={c} className="rounded bg-layer/10 px-1.5 py-0.5 font-mono text-[10px] text-text">
                  NAICS {c}
                </span>
              ))}
            </div>
          ) : null}
          {o.match?.status === "match" && o.match.where === "description" ? (
            <p className="font-body text-[12px] text-text">{o.match.snippet}</p>
          ) : o.description || o.preview ? (
            <p className="line-clamp-6 font-body text-[12px] text-muted">{o.description ? plainText(o.description) : o.preview}</p>
          ) : null}
          {o.earlierNoticeIds.length > 0 ? <p className="font-mono text-[10px] text-muted">Latest of {o.earlierNoticeIds.length + 1} notices for this solicitation (amendments folded in).</p> : null}
          {o.recompete ? (
            <p className="font-body text-[12px] text-muted">
              Bid before as{" "}
              <Link href={`/proposals/${o.recompete.proposalId}/outcome`} className="text-text underline">
                {o.recompete.title}
              </Link>{" "}
              ({o.recompete.outcome === "lost" ? `lost${o.recompete.awardedTo ? ` to ${o.recompete.awardedTo}` : ""}` : "won"}
              {o.recompete.decidedAt ? ` ${o.recompete.decidedAt.slice(0, 4)}` : ""}).{o.recompete.lessons ? ` ${o.recompete.lessons}` : ""}
            </p>
          ) : null}
        </div>
      }
      actions={
        o.alreadyImported ? null : (
          <button type="button" className="aur-btn aur-btn-primary text-[11px]" disabled={busy} onClick={onAdd}>
            Add to pipeline
          </button>
        )
      }
    />
  );
}
