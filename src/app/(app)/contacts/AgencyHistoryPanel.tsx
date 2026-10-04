"use client";

import { useState, useTransition } from "react";
import { formatMoney } from "@/lib/customer-patterns";
import type { AgencyProcurementHistory } from "@/lib/crm-history";
import { agencyHistoryAction } from "./actions";

type Loaded = Extract<AgencyProcurementHistory, { ok: true }>;

/**
 * BL-FB-X-CRM Slice 2 — "what do they buy": the agency's recent awards
 * from USAspending next to the people we know there. Loads on click only;
 * the public API is slow and the answer is the same for everyone in the
 * tenant, so nobody pays for it on page render.
 */
export function AgencyHistoryPanel({ agency, compact }: { agency: string; compact?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [open, setOpen] = useState(!compact);

  function load() {
    setError(null);
    startTransition(async () => {
      const res = await agencyHistoryAction(agency);
      if (!res.ok) {
        setDisabled(!!res.disabled);
        return setError(res.error);
      }
      setData(res);
      setOpen(true);
    });
  }

  if (!agency.trim()) return null;

  return (
    <div className={compact ? "border-t border-layer/10 px-4 py-2" : ""}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">What {agency} buys · USAspending</span>
        {data ? (
          <button type="button" onClick={() => setOpen((v) => !v)} className="font-mono text-[10px] text-indigo-300 hover:underline">
            {open ? "hide" : "show"}
          </button>
        ) : null}
        <button type="button" onClick={load} disabled={pending || disabled} className="aur-btn aur-btn-ghost ml-auto text-[11px] disabled:opacity-60">
          {pending ? "Loading…" : data ? "Reload" : "Load awards"}
        </button>
      </div>
      {error ? <p className={`mt-1 font-mono text-[11px] ${disabled ? "text-muted" : "text-rose-300"}`}>{error}</p> : null}
      {data && open ? <History data={data} /> : null}
    </div>
  );
}

function History({ data }: { data: Loaded }) {
  const s = data.summary;
  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px]">
        <span>
          <span className="text-muted">Awards:</span> <span className="text-text">{s.awards}</span>
          {data.totalRecords > s.awards ? <span className="text-subtle"> of {data.totalRecords}</span> : null}
        </span>
        <span>
          <span className="text-muted">Obligated:</span> <span className="text-text">{formatMoney(s.totalObligated)}</span>
        </span>
        <span>
          <span className="text-muted">Ending within a year:</span> <span className={s.endingWithinYear ? "text-amber-200" : "text-text"}>{s.endingWithinYear}</span>
        </span>
        <span className="text-subtle">
          matched as {data.matchedAs === "subagency" ? "sub-agency" : "department"}
          {data.naicsFiltered ? " · your NAICS only" : " · all NAICS"}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.2em] text-muted">Who wins there</div>
          <ul className="space-y-0.5 font-mono text-[11px]">
            {s.topRecipients.map((r) => (
              <li key={r.name} className="flex justify-between gap-2">
                <span className="truncate text-text">{r.name}</span>
                <span className="shrink-0 text-muted">
                  {formatMoney(r.amount)} · {r.awards}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.2em] text-muted">In which NAICS</div>
          {s.naicsMix.length === 0 ? (
            <p className="font-mono text-[11px] text-muted">No NAICS on these awards.</p>
          ) : (
            <ul className="space-y-0.5 font-mono text-[11px]">
              {s.naicsMix.map((n) => (
                <li key={n.code} className="flex justify-between gap-2">
                  <span className="text-text">NAICS {n.code}</span>
                  <span className="text-muted">{formatMoney(n.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.2em] text-muted">Offices seen</div>
          {s.subAgencies.length === 0 ? (
            <p className="font-mono text-[11px] text-muted">—</p>
          ) : (
            <ul className="space-y-0.5 font-mono text-[11px] text-text">
              {s.subAgencies.map((x) => (
                <li key={x} className="truncate">
                  {x}
                </li>
              ))}
            </ul>
          )}
          {s.latestEndDate ? <p className="mt-1 font-mono text-[10px] text-subtle">Latest period of performance ends {s.latestEndDate}</p> : null}
        </div>
      </div>
      <details className="rounded-md border border-layer/10 bg-layer/[0.02] px-3 py-1.5">
        <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-widest text-muted">Awards ({data.awards.length})</summary>
        <ul className="mt-1.5 divide-y divide-layer/5">
          {data.awards.map((a) => (
            <li key={a.awardId} className="py-1.5">
              <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted">
                <a href={a.uiUrl} target="_blank" rel="noreferrer" className="text-indigo-300 hover:underline">
                  {a.awardId}
                </a>
                <span className="text-text">{a.recipientName}</span>
                <span>{formatMoney(a.amount)}</span>
                {a.naicsCode ? <span>NAICS {a.naicsCode}</span> : null}
                {a.setAsideCode ? <span className="rounded border border-indigo-400/20 bg-indigo-400/5 px-1 text-[9px] uppercase tracking-widest text-indigo-300">{a.setAsideCode}</span> : null}
                {a.endDate ? <span>ends {a.endDate}</span> : null}
              </div>
              {a.description ? <p className="mt-0.5 line-clamp-2 font-body text-[11px] leading-relaxed text-muted">{a.description}</p> : null}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
