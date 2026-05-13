"use client";

import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { CERT_SPECS } from "@/lib/sba-8a";
import {
  importSba8aCsvAction,
  pullSba8aFromSamAction,
  runCertRefreshAction,
  setCertRetentionMonthsAction,
  type CronRefreshResult,
  type ImportRunSummary,
  type ParticipantStats,
} from "./actions";

export function Sba8aAdminClient({
  apiKeyPresent,
  cronSecretPresent,
  initialRuns,
  initialStats,
  initialRetentionMonths,
}: {
  apiKeyPresent: boolean;
  cronSecretPresent: boolean;
  initialRuns: ImportRunSummary[];
  initialStats: ParticipantStats;
  initialRetentionMonths: number;
}) {
  const [runs, setRuns] = useState<ImportRunSummary[]>(initialRuns);
  const [stats, setStats] = useState<ParticipantStats>(initialStats);

  const [certType, setCertType] = useState<string>("8a");
  const [startPage, setStartPage] = useState(1);
  const [pages, setPages] = useState(5);
  const [samError, setSamError] = useState<string | null>(null);
  const [samResult, setSamResult] = useState<string | null>(null);
  const [samBusy, startSam] = useTransition();

  const [retentionMonths, setRetentionMonths] = useState(initialRetentionMonths);
  // Keep the input as a raw string so users can clear and retype
  // without the value snapping to a default mid-edit. Parsing +
  // clamping happens at save time.
  const [retentionDraft, setRetentionDraft] = useState(
    String(initialRetentionMonths),
  );
  const [retentionMessage, setRetentionMessage] = useState<string | null>(null);
  const [retentionError, setRetentionError] = useState<string | null>(null);
  const [retentionBusy, startRetention] = useTransition();

  const [cronResult, setCronResult] = useState<CronRefreshResult | null>(null);
  const [cronError, setCronError] = useState<string | null>(null);
  const [cronBusy, startCron] = useTransition();

  const [csv, setCsv] = useState("");
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvResult, setCsvResult] = useState<string | null>(null);
  const [csvBusy, startCsv] = useTransition();

  const [debug, setDebug] = useState<{
    sample: string;
    keys: string[];
    trace: Array<{
      index: number;
      rawKeys: string[];
      entityRegKeys: string[];
      coreDataKeys: string[];
      ueiSeen: string;
      firmNameSeen: string;
      reason: string;
    }>;
  } | null>(null);

  function pullFromSam() {
    setSamError(null);
    setSamResult(null);
    setDebug(null);
    startSam(async () => {
      const res = await pullSba8aFromSamAction({ startPage, pages, certType });
      if (!res.ok) {
        setSamError(res.error);
        return;
      }
      const certLabel =
        CERT_SPECS.find((c) => c.certType === res.certType)?.label ??
        res.certType;
      setSamResult(
        `[${certLabel}] Pulled ${res.pagesPulled} page(s) · saw ${res.rowsSeen} rows · upserted ${res.rowsUpserted}. ` +
          (res.nextPage
            ? `Continue from page ${res.nextPage}.`
            : `Reached the end of the dataset (${res.totalRecords} records).`),
      );
      if (res.debugSample) {
        setDebug({
          sample: res.debugSample,
          keys: res.debugTopLevelKeys ?? [],
          trace: res.debugNormalizeTrace ?? [],
        });
      }
      if (res.nextPage) setStartPage(res.nextPage);
      // Optimistic stat bump — server-side query reconciles on refresh.
      setStats((s) => bumpStats(s, res.certType, res.rowsUpserted));
      setRuns((prev) => [
        {
          id: crypto.randomUUID(),
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          status: "ok",
          certType: res.certType,
          source: "sam.gov",
          rowsSeen: res.rowsSeen,
          rowsUpserted: res.rowsUpserted,
          error: "",
        },
        ...prev,
      ].slice(0, 10));
    });
  }

  // Parse + validate the draft once per render. The Save button uses
  // these for its disabled state; saveRetention() uses the parsed int.
  const parsedRetentionDraft = Number.parseInt(retentionDraft, 10);
  const retentionDraftValid =
    Number.isFinite(parsedRetentionDraft) &&
    parsedRetentionDraft >= 1 &&
    parsedRetentionDraft <= 240;
  const retentionDraftChanged =
    retentionDraftValid && parsedRetentionDraft !== retentionMonths;

  function saveRetention() {
    setRetentionError(null);
    setRetentionMessage(null);
    if (!retentionDraftValid) {
      setRetentionError("Retention must be a whole number between 1 and 240.");
      return;
    }
    startRetention(async () => {
      const res = await setCertRetentionMonthsAction(parsedRetentionDraft);
      if (!res.ok) {
        setRetentionError(res.error);
        return;
      }
      setRetentionMonths(res.months);
      setRetentionDraft(String(res.months));
      setRetentionMessage(`Retention set to ${res.months} months.`);
      setTimeout(() => setRetentionMessage(null), 2500);
    });
  }

  function triggerCron() {
    setCronError(null);
    setCronResult(null);
    startCron(async () => {
      try {
        const res = await runCertRefreshAction();
        setCronResult(res);
        // Reconcile stats — server query is the source of truth, but
        // we don't have a refresh hook here so just bump optimistically.
        setStats((s) => ({
          ...s,
          total: s.total + res.totalRowsUpserted - res.cleanup.rowsDeleted,
        }));
      } catch (err) {
        setCronError(err instanceof Error ? err.message : String(err));
      }
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
      setStats((s) => bumpStats(s, "8a", res.rowsUpserted));
      setRuns((prev) => [
        {
          id: crypto.randomUUID(),
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          status: "ok",
          certType: "8a",
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
        title="Coverage by cert type"
        eyebrow="Imported firm counts"
        dense
      >
        <table className="w-full text-left font-mono text-[11px]">
          <thead className="bg-white/[0.02] text-muted">
            <tr>
              <th className="px-5 py-2">Cert</th>
              <th className="px-5 py-2 text-right">Total</th>
              <th className="px-5 py-2 text-right">Active</th>
              <th className="px-5 py-2 text-right">Graduated</th>
              <th className="px-5 py-2 text-right">Terminated</th>
              <th className="px-5 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {stats.byCertType.map((row) => (
              <tr key={row.certType}>
                <td className="px-5 py-2">
                  <span className="text-text">{row.label}</span>
                </td>
                <td className="px-5 py-2 text-right">{row.total}</td>
                <td className="px-5 py-2 text-right">{row.active}</td>
                <td
                  className={`px-5 py-2 text-right ${
                    row.graduated > 0 ? "text-emerald-300" : ""
                  }`}
                >
                  {row.graduated}
                </td>
                <td className="px-5 py-2 text-right">{row.terminated}</td>
                <td className="px-5 py-2 text-right">
                  {row.total > 0 ? (
                    <a
                      href={`/intelligence/firms?certType=${encodeURIComponent(
                        row.certType,
                      )}`}
                      className="text-teal hover:underline"
                    >
                      View →
                    </a>
                  ) : (
                    <span className="text-muted/40">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel
        title="Automation"
        eyebrow="Monthly cron · cleanup"
        accent={cronSecretPresent ? "emerald" : "hazard"}
      >
        <p className="mb-3 font-mono text-[11px] text-muted">
          A Vercel Cron job refreshes verified cert types from SAM.gov on
          the <strong>first of each month at 3 AM UTC</strong>. It pulls
          the most recent ~300 firms per verified cert type (catches new
          entrants and updates), then prunes graduated firms whose cert
          exit date is older than the retention window below.
        </p>
        {!cronSecretPresent ? (
          <div className="mb-3 rounded border border-rose/30 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose-200">
            <strong>CRON_SECRET not set.</strong> The cron route refuses
            unauthenticated calls. Add <code className="rounded bg-white/5 px-1">CRON_SECRET</code>{" "}
            (any long random value) to Vercel env vars in Production
            scope and redeploy. Until then the monthly job won't run,
            but the manual "Trigger refresh" button below still works.
          </div>
        ) : null}

        <div className="flex flex-wrap items-end gap-3">
          <Field label="Retention (graduated, months)">
            <input
              type="number"
              min={1}
              max={240}
              inputMode="numeric"
              className="aur-input w-28"
              value={retentionDraft}
              onChange={(e) => setRetentionDraft(e.target.value)}
              aria-invalid={retentionDraft !== "" && !retentionDraftValid}
            />
          </Field>
          <button
            type="button"
            onClick={saveRetention}
            disabled={retentionBusy || !retentionDraftChanged}
            className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-40"
            title={
              !retentionDraftValid
                ? "Enter a whole number between 1 and 240"
                : !retentionDraftChanged
                  ? "No change to save"
                  : undefined
            }
          >
            {retentionBusy ? "Saving…" : "Save retention"}
          </button>
          <div className="grow" />
          <button
            type="button"
            onClick={triggerCron}
            disabled={cronBusy}
            className="aur-btn aur-btn-primary text-[12px] disabled:opacity-60"
            title="Run the same job the monthly cron runs — refresh all verified cert types, then prune stale graduates."
          >
            {cronBusy ? "Refreshing…" : "Trigger refresh now"}
          </button>
        </div>

        <p className="mt-2 font-mono text-[11px] text-muted/70">
          Current retention: <strong className="text-text">{retentionMonths} months</strong>.
          Graduated firms with cert exit date older than this get pruned
          on every cron run.
        </p>

        {retentionError ? (
          <div className="mt-3 rounded border border-rose/30 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose-200">
            {retentionError}
          </div>
        ) : null}
        {retentionMessage ? (
          <div className="mt-3 rounded border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 font-mono text-[11px] text-emerald-200">
            {retentionMessage}
          </div>
        ) : null}

        {cronError ? (
          <div className="mt-3 rounded border border-rose/30 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose-200">
            <strong>Refresh failed:</strong> {cronError}
          </div>
        ) : null}
        {cronResult ? (
          <div className="mt-3 rounded border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 font-mono text-[11px] text-emerald-200">
            <div>
              Refreshed {cronResult.totalRowsUpserted} firms across{" "}
              {cronResult.pulled.length} verified cert types in{" "}
              {Math.round(cronResult.durationMs / 100) / 10}s.
            </div>
            <div className="mt-1">
              Pruned {cronResult.cleanup.rowsDeleted} graduated firms older than{" "}
              {cronResult.cleanup.retentionMonths} months.
            </div>
            {cronResult.pulled.some((p) => p.error) ? (
              <div className="mt-2 text-amber-200">
                Some cert types had errors:{" "}
                {cronResult.pulled
                  .filter((p) => p.error)
                  .map((p) => `${p.certType}: ${p.error}`)
                  .join("; ")}
              </div>
            ) : null}
          </div>
        ) : null}
      </Panel>

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
          <Field label="Cert type">
            <select
              className="aur-input w-48"
              value={certType}
              onChange={(e) => {
                setCertType(e.target.value);
                setStartPage(1);
                setSamResult(null);
                setSamError(null);
              }}
            >
              {CERT_SPECS.map((c) => (
                <option key={c.certType} value={c.certType}>
                  {c.label}
                  {c.verified ? "" : " (unverified)"}
                </option>
              ))}
            </select>
          </Field>
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
        {debug ? (
          <div className="mt-3 rounded border border-amber-400/30 bg-amber-400/[0.06] px-3 py-2 font-mono text-[10px] text-amber-100">
            <div className="mb-2 font-display text-[12px] font-semibold text-amber-200">
              Diagnostic: zero rows but SAM accepted the request
            </div>
            <div className="mb-1">
              Top-level keys returned:{" "}
              <code>{debug.keys.length ? debug.keys.join(", ") : "(none)"}</code>
            </div>
            <div className="mb-1">Raw response sample (first 1 KB):</div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-black/30 p-2 text-amber-50">
              {debug.sample}
            </pre>
            {debug.trace.length > 0 ? (
              <div className="mt-3">
                <div className="mb-1 font-display text-[11px] font-semibold text-amber-200">
                  Per-entity normalize trace (first {debug.trace.length}):
                </div>
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 text-amber-50">
                  {JSON.stringify(debug.trace, null, 2)}
                </pre>
              </div>
            ) : null}
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
                <th className="px-5 py-2">Cert</th>
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
                  <td className="px-5 py-2">
                    {CERT_SPECS.find((c) => c.certType === r.certType)?.label ??
                      r.certType}
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

/**
 * Optimistic stat bump after a successful pull. Bumps both the cert-
 * specific row and the aggregate totals so the page reflects the
 * change before the next server render reconciles. Approximate —
 * we increment `active` by the upserted count which is right for the
 * common case (most pulled firms are active), close enough for
 * graduates since graduations are rare in any single batch.
 */
function bumpStats(
  prev: ParticipantStats,
  certType: string,
  upserted: number,
): ParticipantStats {
  if (upserted <= 0) return prev;
  return {
    total: prev.total + upserted,
    active: prev.active + upserted,
    graduated: prev.graduated,
    terminated: prev.terminated,
    byCertType: prev.byCertType.map((r) =>
      r.certType === certType
        ? { ...r, total: r.total + upserted, active: r.active + upserted }
        : r,
    ),
  };
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
