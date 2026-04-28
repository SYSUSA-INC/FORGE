"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { GSA_VEHICLES } from "@/lib/gsa-vehicles";
import {
  importSamGovOpportunitiesAction,
  loadSamGovOpportunitiesAction,
  type ImportableOpportunity,
} from "./actions";

export function ImportClient({ defaultNaics }: { defaultNaics: string[] }) {
  const router = useRouter();
  const [naicsInput, setNaicsInput] = useState(defaultNaics.join(", "));
  const [keyword, setKeyword] = useState("");
  const [postedDaysBack, setPostedDaysBack] = useState(30);
  const [gsaOnly, setGsaOnly] = useState(false);
  const [vehicleIds, setVehicleIds] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<ImportableOpportunity[] | null>(null);
  const [totalRecords, setTotalRecords] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, startLoading] = useTransition();
  const [importing, startImporting] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (defaultNaics.length > 0 && results === null) {
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
    setSelected(new Set());
    startLoading(async () => {
      const res = await loadSamGovOpportunitiesAction({
        naicsCodes: parsedNaics(),
        keyword: keyword.trim() || undefined,
        postedDaysBack,
        gsaOnly,
        vehicleIds: Array.from(vehicleIds),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResults(res.opportunities);
      setTotalRecords(res.totalRecords);
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
      const res = await importSamGovOpportunitiesAction(
        Array.from(selected),
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice(
        `Imported ${res.imported} ${res.imported === 1 ? "opportunity" : "opportunities"}${
          res.skipped > 0 ? ` · skipped ${res.skipped} duplicates` : ""
        }.`,
      );
      setSelected(new Set());
      router.refresh();
      search();
    });
  }

  const selectableCount = useMemo(
    () => (results ?? []).filter((o) => !o.alreadyImported).length,
    [results],
  );

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Search SAM.gov" eyebrow="Active solicitations">
        <div className="mb-3 rounded-lg border border-white/10 bg-white/[0.015] p-3">
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
                        : "border-white/15 bg-white/[0.02] text-muted hover:border-white/30 hover:text-text"
                    }`}
                  >
                    {v.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-1 font-mono text-[10px] text-muted">
              Adds vehicle keywords to the SAM.gov query. eBuy RFQs aren&rsquo;t
              indexed by SAM.gov &mdash; for those, paste from eBuy on the
              next page (coming soon).
            </div>
          </div>
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
              placeholder="Optional — e.g., cybersecurity"
            />
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
          eyebrow={`${results.length} shown · ${totalRecords} total`}
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
          {results.length === 0 ? (
            <div className="font-mono text-[11px] text-muted">
              No active solicitations match. Try expanding the time window, a
              different NAICS, or a keyword.
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
          ? "border-white/10 bg-white/[0.015] opacity-60"
          : checked
            ? "border-teal-400 bg-teal-400/5"
            : "border-white/10 bg-white/[0.02] hover:border-white/20"
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
              <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted">
                Already imported
              </span>
            ) : null}
            {o.type ? (
              <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-muted">
                {o.type}
              </span>
            ) : null}
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
            {[o.department, o.subTier].filter(Boolean).join(" · ") || "—"}
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
          {o.description ? (
            <div className="mt-2 line-clamp-3 font-body text-[12px] text-muted">
              {o.description.replace(/<[^>]*>/g, "")}
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
