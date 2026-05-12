"use client";

import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import {
  importSba8aCsvAction,
  pullSba8aFromSamAction,
  type ImportRunSummary,
} from "./actions";

type Stats = {
  total: number;
  active: number;
  graduated: number;
  terminated: number;
};

export function Sba8aAdminClient({
  apiKeyPresent,
  initialRuns,
  initialStats,
}: {
  apiKeyPresent: boolean;
  initialRuns: ImportRunSummary[];
  initialStats: Stats;
}) {
  const [runs, setRuns] = useState<ImportRunSummary[]>(initialRuns);
  const [stats, setStats] = useState<Stats>(initialStats);

  const [startPage, setStartPage] = useState(1);
  const [pages, setPages] = useState(5);
  const [samError, setSamError] = useState<string | null>(null);
  const [samResult, setSamResult] = useState<string | null>(null);
  const [samBusy, startSam] = useTransition();

  const [csv, setCsv] = useState("");
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvResult, setCsvResult] = useState<string | null>(null);
  const [csvBusy, startCsv] = useTransition();

  function pullFromSam() {
    setSamError(null);
    setSamResult(null);
    startSam(async () => {
      const res = await pullSba8aFromSamAction({ startPage, pages });
      if (!res.ok) {
        setSamError(res.error);
        return;
      }
      setSamResult(
        `Pulled ${res.pagesPulled} page(s) · saw ${res.rowsSeen} rows · upserted ${res.rowsUpserted}. ` +
          (res.nextPage
            ? `Continue from page ${res.nextPage}.`
            : `Reached the end of the dataset (${res.totalRecords} records).`),
      );
      if (res.nextPage) setStartPage(res.nextPage);
      // Optimistic stat bump — the next page refresh will reconcile.
      setStats((s) => ({ ...s, total: s.total + res.rowsUpserted }));
      setRuns((prev) => [
        {
          id: crypto.randomUUID(),
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          status: "ok",
          source: "sam.gov",
          rowsSeen: res.rowsSeen,
          rowsUpserted: res.rowsUpserted,
          error: "",
        },
        ...prev,
      ].slice(0, 10));
    });
  }

  function importCsv() {
    setCsvError(null);
    setCsvResult(null);
    startCsv(async () => {
      const res = await importSba8aCsvAction(csv);
      if (!res.ok) {
        setCsvError(res.error);
        return;
      }
      setCsvResult(
        `Saw ${res.rowsSeen} rows · upserted ${res.rowsUpserted}` +
          (res.skipped ? ` · skipped ${res.skipped} (missing UEI/name)` : ""),
      );
      setCsv("");
      setStats((s) => ({ ...s, total: s.total + res.rowsUpserted }));
      setRuns((prev) => [
        {
          id: crypto.randomUUID(),
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          status: "ok",
          source: "manual_csv",
          rowsSeen: res.rowsSeen,
          rowsUpserted: res.rowsUpserted,
          error: "",
        },
        ...prev,
      ].slice(0, 10));
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Pull from SAM.gov"
        eyebrow="Live fetch · sbaBusinessTypeCode=A6"
      >
        <p className="mb-3 font-mono text-[11px] text-muted">
          Pulls one batch of pages and upserts by UEI. Click again to continue
          from the next page. Each page is 10 firms (free-tier cap). The SAM.gov API
          tier limits ~1000 calls/day.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Start page">
            <input
              type="number"
              min={1}
              className="aur-input w-24"
              value={startPage}
              onChange={(e) => setStartPage(Math.max(1, Number(e.target.value || 1)))}
            />
          </Field>
          <Field label="Pages per click">
            <input
              type="number"
              min={1}
              max={50}
              className="aur-input w-24"
              value={pages}
              onChange={(e) => setPages(Math.max(1, Math.min(50, Number(e.target.value || 25))))}
            />
          </Field>
          <button
            type="button"
            onClick={pullFromSam}
            disabled={samBusy || !apiKeyPresent}
            className="aur-btn aur-btn-primary text-[12px] disabled:opacity-60"
          >
            {samBusy ? "Pulling…" : "Pull batch"}
          </button>
        </div>
        {samError ? (
          <div className="mt-3 rounded border border-rose/30 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose-200">
            {samError}
          </div>
        ) : null}
        {samResult ? (
          <div className="mt-3 rounded border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 font-mono text-[11px] text-emerald-200">
            {samResult}
          </div>
        ) : null}
      </Panel>

      <Panel title="Paste CSV" eyebrow="Manual import">
        <p className="mb-2 font-mono text-[11px] text-muted">
          Headers (case-insensitive): <code>uei</code>, <code>firm_name</code>{" "}
          (or "legal business name"), <code>cert_entry_date</code>,{" "}
          <code>cert_exit_date</code> (or "graduation date"),{" "}
          <code>naics</code>, <code>city</code>, <code>state</code>. Other
          columns are ignored. Skipped rows lack UEI or firm name.
        </p>
        <textarea
          rows={10}
          className="aur-input w-full font-mono text-[11px]"
          placeholder={`uei,firm_name,cert_entry_date,cert_exit_date,naics,city,state\nXYZ123456789,Acme Solutions,2020-01-15,2029-01-14,541512,Arlington,VA`}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
        />
        <div className="mt-3 flex items-center justify-end">
          <button
            type="button"
            onClick={importCsv}
            disabled={csvBusy || !csv.trim()}
            className="aur-btn aur-btn-primary text-[12px] disabled:opacity-60"
          >
            {csvBusy ? "Importing…" : "Import CSV"}
          </button>
        </div>
        {csvError ? (
          <div className="mt-3 rounded border border-rose/30 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose-200">
            {csvError}
          </div>
        ) : null}
        {csvResult ? (
          <div className="mt-3 rounded border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 font-mono text-[11px] text-emerald-200">
            {csvResult}
          </div>
        ) : null}
      </Panel>

      <Panel title="Recent imports" eyebrow="Last 10 runs" dense>
        {runs.length === 0 ? (
          <p className="px-5 py-4 font-mono text-[12px] text-muted">
            No imports yet.
          </p>
        ) : (
          <table className="w-full text-left font-mono text-[11px]">
            <thead className="bg-white/[0.02] text-muted">
              <tr>
                <th className="px-5 py-2">Started</th>
                <th className="px-5 py-2">Source</th>
                <th className="px-5 py-2">Status</th>
                <th className="px-5 py-2">Seen</th>
                <th className="px-5 py-2">Upserted</th>
                <th className="px-5 py-2">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="px-5 py-2 text-muted">
                    {formatStarted(r.startedAt)}
                  </td>
                  <td className="px-5 py-2">{r.source}</td>
                  <td className="px-5 py-2">
                    <span
                      className={
                        r.status === "ok"
                          ? "text-emerald-300"
                          : r.status === "failed"
                            ? "text-rose-300"
                            : "text-muted"
                      }
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-5 py-2">{r.rowsSeen}</td>
                  <td className="px-5 py-2">{r.rowsUpserted}</td>
                  <td className="max-w-[280px] truncate px-5 py-2 text-rose-300">
                    {r.error}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
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

function formatStarted(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      year: "2-digit",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
