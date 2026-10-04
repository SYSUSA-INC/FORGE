"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { downloadCsv, type CsvColumn } from "@/lib/csv-export";
import { formatDollars } from "@/lib/money";
import { formatRate, REPORT_RANGE_LABELS, REPORT_RANGES, type Report, type WinRateRow } from "@/lib/reports-logic";
import { recordReportExportAction } from "./actions";

/**
 * BL-PACKAGES add-ons Slice 2c — the Reports tables. Each is the chart's
 * own table view: one thin bar per row (one hue; the numbers stay in
 * text colours), a hover title with the exact figures, and a CSV
 * download that is checked and audited server-side first.
 */
export function ReportsClient({ report }: { report: Report }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function exportCsv<T>(table: string, filename: string, rows: T[], columns: CsvColumn<T>[]) {
    setError(null);
    startTransition(async () => {
      const res = await recordReportExportAction({ table, range: report.range });
      if (!res.ok) return setError(res.error);
      downloadCsv(`${filename}-${report.range}.csv`, rows, columns);
    });
  }

  const winColumns = (label: string): CsvColumn<WinRateRow>[] => [
    { header: label, get: (r) => r.key },
    { header: "Won", get: (r) => r.won },
    { header: "Lost", get: (r) => r.lost },
    { header: "No bid", get: (r) => r.noBid },
    { header: "Win rate %", get: (r) => (r.winRate === null ? "" : Math.round(r.winRate * 100)) },
    { header: "Won value (USD)", get: (r) => Math.round(r.wonValue) },
  ];

  const csvButton = (onClick: () => void) => (
    <button type="button" onClick={onClick} disabled={pending} className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-50">
      Download CSV
    </button>
  );

  const maxReached = Math.max(1, ...report.funnel.map((f) => f.reached));
  const maxMonth = Math.max(1, ...report.months.map((m) => Math.max(m.created, m.won)));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {REPORT_RANGES.map((r) => (
          <Link
            key={r}
            href={`/reports?range=${r}`}
            className={`rounded-full border px-3 py-1 font-mono text-[11px] ${r === report.range ? "border-teal/40 bg-teal/10 text-text" : "border-layer/10 text-muted hover:text-text"}`}
          >
            {REPORT_RANGE_LABELS[r]}
          </Link>
        ))}
        {error ? <span className="font-mono text-[11px] text-rose">{error}</span> : null}
      </div>

      <WinRateTable title="Win rate by agency" label="Agency" rows={report.byAgency} onCsv={() => exportCsv("agency", "win-rate-by-agency", report.byAgency, winColumns("Agency"))} csvButton={csvButton} />
      <WinRateTable title="Win rate by NAICS" label="NAICS" rows={report.byNaics} onCsv={() => exportCsv("naics", "win-rate-by-naics", report.byNaics, winColumns("NAICS"))} csvButton={csvButton} />
      <WinRateTable title="Win rate by set-aside" label="Set-aside" rows={report.bySetAside} onCsv={() => exportCsv("set_aside", "win-rate-by-set-aside", report.bySetAside, winColumns("Set-aside"))} csvButton={csvButton} />

      <Panel
        title="Stage funnel"
        eyebrow="How far opportunities got"
        actions={csvButton(() =>
          exportCsv("funnel", "stage-funnel", report.funnel, [
            { header: "Stage", get: (f) => f.label },
            { header: "Now at stage", get: (f) => f.current },
            { header: "Reached", get: (f) => f.reached },
            { header: "Conversion from previous %", get: (f) => (f.conversion === null ? "" : Math.round(f.conversion * 100)) },
          ]),
        )}
      >
        <p className="mb-3 font-mono text-[10px] text-muted">
          Reached = got at least this far. A lost bid counts as having reached Submitted; a no-bid as having left at Qualification.
        </p>
        <table className="w-full text-left font-body text-[13px]">
          <thead>
            <tr className="font-mono text-[10px] uppercase tracking-wider text-muted">
              <th className="py-2 pr-3">Stage</th>
              <th className="py-2 pr-3 text-right">Now</th>
              <th className="py-2 pr-3 text-right">Reached</th>
              <th className="w-1/3 py-2 pr-3" />
              <th className="py-2 text-right">Conversion</th>
            </tr>
          </thead>
          <tbody>
            {report.funnel.map((f) => (
              <tr key={f.stage} className="border-t border-layer/10">
                <td className="py-2 pr-3 text-text">{f.label}</td>
                <td className="py-2 pr-3 text-right font-mono text-[12px] text-muted">{f.current}</td>
                <td className="py-2 pr-3 text-right font-mono text-[12px] text-text">{f.reached}</td>
                <td className="py-2 pr-3">
                  <Bar value={f.reached} max={maxReached} title={`${f.label}: ${f.reached} reached`} />
                </td>
                <td className="py-2 text-right font-mono text-[12px] text-text">{formatRate(f.conversion)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel
        title="Created and won by month"
        eyebrow="Last 12 months"
        actions={csvButton(() =>
          exportCsv("months", "created-and-won-by-month", report.months, [
            { header: "Month", get: (m) => m.month },
            { header: "Created", get: (m) => m.created },
            { header: "Created value (USD)", get: (m) => Math.round(m.createdValue) },
            { header: "Won", get: (m) => m.won },
            { header: "Won value (USD)", get: (m) => Math.round(m.wonValue) },
          ]),
        )}
      >
        <div className="mb-3 flex items-center gap-4 font-mono text-[10px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-4 rounded bg-layer/30" /> Created
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-4 rounded bg-teal" /> Won
          </span>
          <span>Won month = award date, else when it was marked won.</span>
        </div>
        <table className="w-full text-left font-body text-[13px]">
          <thead>
            <tr className="font-mono text-[10px] uppercase tracking-wider text-muted">
              <th className="py-2 pr-3">Month</th>
              <th className="w-1/3 py-2 pr-3" />
              <th className="py-2 pr-3 text-right">Created</th>
              <th className="py-2 pr-3 text-right">Won</th>
              <th className="py-2 text-right">Won value</th>
            </tr>
          </thead>
          <tbody>
            {report.months.map((m) => (
              <tr key={m.month} className="border-t border-layer/10">
                <td className="py-2 pr-3 font-mono text-[12px] text-text">{m.month}</td>
                <td className="py-2 pr-3">
                  <div className="flex flex-col gap-0.5">
                    <Bar value={m.created} max={maxMonth} title={`${m.month}: ${m.created} created`} tone="base" />
                    <Bar value={m.won} max={maxMonth} title={`${m.month}: ${m.won} won (${formatDollars(m.wonValue)})`} />
                  </div>
                </td>
                <td className="py-2 pr-3 text-right font-mono text-[12px] text-muted">{m.created}</td>
                <td className="py-2 pr-3 text-right font-mono text-[12px] text-text">{m.won}</td>
                <td className="py-2 text-right font-mono text-[12px] text-text">{formatDollars(m.wonValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function WinRateTable({
  title,
  label,
  rows,
  onCsv,
  csvButton,
}: {
  title: string;
  label: string;
  rows: WinRateRow[];
  onCsv: () => void;
  csvButton: (onClick: () => void) => JSX.Element;
}) {
  return (
    <Panel title={title} eyebrow="Decided opportunities" actions={rows.length > 0 ? csvButton(onCsv) : null}>
      {rows.length === 0 ? (
        <p className="font-body text-[13px] text-muted">No won, lost or no-bid opportunities in this period yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left font-body text-[13px]">
            <thead>
              <tr className="font-mono text-[10px] uppercase tracking-wider text-muted">
                <th className="py-2 pr-3">{label}</th>
                <th className="py-2 pr-3 text-right">Won</th>
                <th className="py-2 pr-3 text-right">Lost</th>
                <th className="py-2 pr-3 text-right">No bid</th>
                <th className="w-1/4 py-2 pr-3" />
                <th className="py-2 pr-3 text-right">Win rate</th>
                <th className="py-2 text-right">Won value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-layer/10">
                  <td className="py-2 pr-3 text-text">{r.key}</td>
                  <td className="py-2 pr-3 text-right font-mono text-[12px] text-text">{r.won}</td>
                  <td className="py-2 pr-3 text-right font-mono text-[12px] text-muted">{r.lost}</td>
                  <td className="py-2 pr-3 text-right font-mono text-[12px] text-muted">{r.noBid}</td>
                  <td className="py-2 pr-3">
                    {r.winRate === null ? null : <Bar value={r.winRate} max={1} title={`${r.key}: ${r.won} of ${r.decided} decided won`} />}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono text-[12px] text-text">{formatRate(r.winRate)}</td>
                  <td className="py-2 text-right font-mono text-[12px] text-text">{formatDollars(r.wonValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** One thin bar anchored left; the exact figure is in the row and the hover title. */
function Bar({ value, max, title, tone = "accent" }: { value: number; max: number; title: string; tone?: "accent" | "base" }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="h-2 w-full rounded bg-layer/5" title={title}>
      {pct > 0 ? <div className={`h-2 rounded ${tone === "accent" ? "bg-teal" : "bg-layer/30"}`} style={{ width: `${pct}%` }} /> : null}
    </div>
  );
}
