"use client";

/**
 * BL-15 Phase B-3c — superadmin UI for runtime isolation checks.
 *
 * Renders a "Run isolation check" button and a list of recent
 * results. The button POSTs to `runIsolationCheckAction` which picks
 * a phantom-attacker tenant + probes three representative tables.
 *
 * Pass / fail colouring is intentionally stark: a failed check
 * means a real cross-tenant leak was observed at runtime, which is
 * a Severity-1 finding. The notes column carries any nuance from
 * the runner (e.g. "only one tenant — no probes possible").
 */

import { useEffect, useState, useTransition } from "react";
import {
  listIsolationCheckResultsAction,
  runIsolationCheckAction,
  type IsolationCheckSummary,
} from "./isolation-check-actions";

type Props = {
  organizationId: string;
};

export function IsolationCheckPanel({ organizationId }: Props) {
  const [results, setResults] = useState<IsolationCheckSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void listIsolationCheckResultsAction({ organizationId, limit: 10 }).then(
      (res) => {
        if (cancelled) return;
        setLoading(false);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setResults(res.results);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  function runCheck() {
    setError(null);
    startTransition(async () => {
      const res = await runIsolationCheckAction({ organizationId });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Prepend the new result so the operator sees it immediately.
      setResults((prev) => [res.result, ...prev].slice(0, 10));
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 className="font-stencil text-[12px] uppercase tracking-[0.25em] text-text">
            Runtime isolation check
          </h3>
          <p className="font-mono text-[10px] text-muted">
            Probes 3 representative tables against a phantom attacker
            tenant. Failed checks are real cross-tenant leaks.
          </p>
        </div>
        <button
          type="button"
          onClick={runCheck}
          disabled={pending}
          className="aur-btn aur-btn-primary text-[11px] disabled:opacity-40"
        >
          {pending ? "Running…" : "Run isolation check"}
        </button>
      </div>

      {error && (
        <p className="font-mono text-[10px] text-rose">{error}</p>
      )}

      {loading ? (
        <p className="font-mono text-[11px] text-muted">Loading…</p>
      ) : results.length === 0 ? (
        <p className="font-mono text-[11px] text-muted">
          No checks have been run for this tenant yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {results.map((r) => (
            <ResultRow key={r.id} result={r} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ResultRow({ result }: { result: IsolationCheckSummary }) {
  const failed = result.failedChecks > 0;
  const allSkipped =
    result.totalChecks > 0 && result.skippedChecks === result.totalChecks;
  const tone: "pass" | "fail" | "neutral" = failed
    ? "fail"
    : allSkipped
      ? "neutral"
      : "pass";

  return (
    <li className="flex flex-col gap-1 rounded border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <StatusBadge tone={tone} />
          <span className="font-mono text-[10px] text-text">
            {formatTimestamp(result.triggeredAt)}
          </span>
          <span className="font-mono text-[9px] text-subtle">
            · {result.passedChecks} pass · {result.failedChecks} fail
            {result.skippedChecks > 0
              ? ` · ${result.skippedChecks} skipped`
              : ""}
          </span>
        </div>
      </div>
      {result.notes && (
        <p className="font-mono text-[9px] text-subtle">{result.notes}</p>
      )}
      <ul className="flex flex-col gap-0.5 pl-2">
        {result.details.map((d, idx) => (
          <li
            key={`${d.table}-${idx}`}
            className="font-mono text-[9px] text-muted"
          >
            <span
              className={
                d.status === "fail"
                  ? "text-rose"
                  : d.status === "pass"
                    ? "text-emerald"
                    : "text-subtle"
              }
            >
              {d.status.toUpperCase()}
            </span>{" "}
            <span className="text-text">{d.table}</span>{" "}
            {d.status === "pass" && (
              <span className="text-subtle">
                · 0 of {d.attackerRowIdsSampled} attacker ids leaked
              </span>
            )}
            {d.status === "fail" && (
              <span className="text-rose">
                · {d.rowsLeaked} of {d.attackerRowIdsSampled} attacker ids leaked
              </span>
            )}
            {d.status === "skipped" && d.reason && (
              <span className="text-subtle">· {d.reason}</span>
            )}
          </li>
        ))}
      </ul>
    </li>
  );
}

function StatusBadge({ tone }: { tone: "pass" | "fail" | "neutral" }) {
  const STYLE: Record<
    "pass" | "fail" | "neutral",
    { bg: string; border: string; color: string; label: string }
  > = {
    pass: {
      bg: "rgba(74, 222, 128, 0.10)",
      border: "1px solid rgba(74, 222, 128, 0.30)",
      color: "#4ADE80",
      label: "PASS",
    },
    fail: {
      bg: "rgba(248, 113, 113, 0.12)",
      border: "1px solid rgba(248, 113, 113, 0.40)",
      color: "#F87171",
      label: "FAIL",
    },
    neutral: {
      bg: "rgba(148, 163, 184, 0.10)",
      border: "1px solid rgba(148, 163, 184, 0.30)",
      color: "#94A3B8",
      label: "N/A",
    },
  };
  const s = STYLE[tone];
  return (
    <span
      className="rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider"
      style={{ background: s.bg, border: s.border, color: s.color }}
    >
      {s.label}
    </span>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
