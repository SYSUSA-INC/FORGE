"use client";

import { useState, type ReactNode } from "react";

/**
 * BL-SCOUT-ONEPAGE — one row of the Scout's results, the same for every
 * source (the nightly finds, a SAM.gov search, a pasted eBuy RFQ): the
 * AI's call, the title and agency, the source, the due date, the fit and
 * the actions (Add to pipeline first) on one line; the reasons, the AI's
 * rationale and the description open below it.
 */
export type ResultCall = { label: string; tone: "pursue" | "watch" | "skip" | "none"; title?: string };

const TONE: Record<ResultCall["tone"], string> = {
  pursue: "border-emerald/40 bg-emerald/10 text-emerald-300",
  watch: "border-cobalt/40 bg-cobalt/10 text-text",
  skip: "border-rose/40 bg-rose/10 text-rose-300",
  none: "border-layer/15 bg-layer/[0.04] text-muted",
};

export function ResultRow({
  call,
  title,
  href,
  meta,
  source,
  due,
  dueSoon,
  fit,
  badges,
  details,
  actions,
  select,
  muted,
  defaultOpen = false,
}: {
  call: ResultCall;
  title: string;
  /** The notice on its source (SAM.gov), opened in a new tab. */
  href?: string | null;
  /** Agency · notice type · NAICS, in one line. */
  meta: string;
  source: string;
  /** "25d", "due 2d ago", "ends in 90d", or null. */
  due: string | null;
  dueSoon?: boolean;
  fit?: number | null;
  /** Short tags beside the title (In the pipeline, Recompete). */
  badges?: ReactNode;
  /** What opens below the row: reasons, rationale, description. */
  details?: ReactNode;
  actions: ReactNode;
  /** A checkbox for picking several (SAM.gov search). */
  select?: { checked: boolean; disabled?: boolean; onToggle: () => void };
  muted?: boolean;
  /** Open on arrival (a pasted RFQ, whose fields are reviewed before it is added). */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <li className={`border-b border-layer/10 py-2.5 last:border-b-0 ${muted ? "opacity-60" : ""}`}>
      <div className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-2 md:grid-cols-[auto_minmax(0,1fr)_6rem_5rem_3rem_auto] md:items-center">
        <div className="flex items-center gap-2">
          {select ? (
            <input type="checkbox" aria-label={`Pick ${title}`} checked={select.checked} disabled={select.disabled} onChange={select.onToggle} />
          ) : null}
          <span className={`inline-block w-[5.5rem] rounded border px-1.5 py-0.5 text-center font-mono text-[10px] uppercase tracking-widest ${TONE[call.tone]}`} title={call.title}>
            {call.label}
          </span>
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {details ? (
              <button
                type="button"
                className="min-w-0 truncate text-left font-display text-[14px] text-text hover:underline"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                title={open ? "Hide the details" : "Show the reasons, the AI's rationale and the description"}
              >
                <span aria-hidden className="mr-1 inline-block w-3 font-mono text-[11px] text-muted">{open ? "−" : "+"}</span>
                {title}
              </button>
            ) : (
              <span className="min-w-0 truncate font-display text-[14px] text-text">{title}</span>
            )}
            {badges}
          </div>
          <div className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-label text-muted">
            {meta || "—"}
            {href ? (
              <>
                {" · "}
                <a href={href} target="_blank" rel="noopener noreferrer" className="normal-case tracking-normal text-cobalt hover:underline">
                  notice ↗
                </a>
              </>
            ) : null}
          </div>
        </div>
        <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] md:contents">
          <span className="text-muted md:truncate">{source}</span>
          <span className={dueSoon ? "text-rose-300" : "text-muted"}>{due ?? "—"}</span>
          <span className="text-text" title="FORGE's fit score, from the reasons shown">{fit === null || fit === undefined ? "—" : fit}</span>
          <div className="flex flex-wrap items-center gap-2 md:justify-end">{actions}</div>
        </div>
      </div>
      {open && details ? <div className="mt-2 pl-0 md:pl-[6.5rem]">{details}</div> : null}
    </li>
  );
}

/** The column heads above a list of rows (wide screens only). */
export function ResultHead({ select = false }: { select?: boolean }) {
  return (
    <div className="hidden grid-cols-[auto_minmax(0,1fr)_6rem_5rem_3rem_auto] gap-x-3 border-b border-layer/10 pb-1.5 font-mono text-[10px] uppercase tracking-label text-muted md:grid">
      <span className={select ? "w-[7rem] pl-6" : "w-[5.5rem]"}>AI call</span>
      <span>Opportunity</span>
      <span>Source</span>
      <span>Due</span>
      <span>Fit</span>
      <span className="text-right">Add or set aside</span>
    </div>
  );
}
