"use client";

import { useState, useTransition } from "react";
import { Panel } from "@/components/ui/Panel";
import { runProposalScanAction, type ProposalScanResult } from "./scan-actions";

type ScanData = Extract<ProposalScanResult, { ok: true }>;

const SCORE_STYLES: Record<
  ScanData["overallScore"],
  { label: string; color: string; bg: string; border: string }
> = {
  strong: {
    label: "Strong",
    color: "#34d399",
    bg: "rgba(52,211,153,0.08)",
    border: "rgba(52,211,153,0.30)",
  },
  needs_work: {
    label: "Needs work",
    color: "#fbbf24",
    bg: "rgba(251,191,36,0.08)",
    border: "rgba(251,191,36,0.30)",
  },
  critical: {
    label: "Critical gaps",
    color: "#f87171",
    bg: "rgba(248,113,113,0.08)",
    border: "rgba(248,113,113,0.30)",
  },
};

const SEVERITY_COLOR: Record<string, string> = {
  high: "#f87171",
  medium: "#fbbf24",
  low: "#94a3b8",
};

export function ProposalScanPanel({ proposalId }: { proposalId: string }) {
  const [scan, setScan] = useState<ScanData | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function runScan() {
    setError(null);
    startTransition(async () => {
      const res = await runProposalScanAction(proposalId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setScan(res);
    });
  }

  const scoreStyle = scan ? SCORE_STYLES[scan.overallScore] : null;

  return (
    <Panel
      title="AI Health Check"
      eyebrow={
        scan
          ? `Scanned ${new Date(scan.generatedAt).toLocaleString()}${scan.stubbed ? " · stub" : ""}`
          : "Scan in-flight proposal for gaps"
      }
      actions={
        <button
          type="button"
          onClick={runScan}
          disabled={pending}
          className="aur-btn aur-btn-ghost text-[11px] disabled:opacity-60"
        >
          {pending ? "Scanning…" : scan ? "Re-scan" : "Scan now"}
        </button>
      }
    >
      {!scan && !error ? (
        <p className="font-body text-[12px] leading-relaxed text-muted">
          Checks every section for empty content, thin drafts, and compliance
          gaps against the solicitation requirements. Uses one AI request.
        </p>
      ) : null}

      {error ? (
        <div className="rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}

      {pending ? (
        <div className="mt-2 font-mono text-[10px] text-muted">
          Reading sections and requirements…
        </div>
      ) : null}

      {scan ? (
        <div className="mt-3 space-y-4">
          {/* Overall score badge */}
          {scoreStyle ? (
            <div
              className="inline-flex items-center gap-2 rounded px-2.5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider"
              style={{
                color: scoreStyle.color,
                background: scoreStyle.bg,
                border: `1px solid ${scoreStyle.border}`,
              }}
            >
              {scoreStyle.label}
            </div>
          ) : null}

          {/* Summary */}
          <p className="font-body text-[13px] leading-relaxed text-foreground">
            {scan.summary}
          </p>

          {/* Section issues */}
          {scan.sectionIssues.length > 0 ? (
            <div>
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
                Section issues ({scan.sectionIssues.length})
              </div>
              <ul className="space-y-2">
                {scan.sectionIssues.map((issue) => (
                  <li
                    key={issue.sectionId}
                    className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[12px] text-text">
                        {issue.sectionTitle}
                      </span>
                      <span
                        className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest"
                        style={{
                          color: SEVERITY_COLOR[issue.severity] ?? "#94a3b8",
                          background: `${SEVERITY_COLOR[issue.severity] ?? "#94a3b8"}1a`,
                          border: `1px solid ${SEVERITY_COLOR[issue.severity] ?? "#94a3b8"}40`,
                        }}
                      >
                        {issue.severity}
                      </span>
                    </div>
                    <p className="mt-1 font-body text-[12px] leading-relaxed text-muted">
                      {issue.issue}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="font-mono text-[11px] text-emerald">
              No section issues found.
            </div>
          )}

          {/* Recommendations */}
          {scan.topRecommendations.length > 0 ? (
            <div>
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
                Top recommendations
              </div>
              <ol className="space-y-1">
                {scan.topRecommendations.map((rec, i) => (
                  <li
                    key={i}
                    className="flex gap-2 font-body text-[12px] leading-relaxed text-foreground"
                  >
                    <span className="shrink-0 font-mono text-[10px] text-muted">
                      {i + 1}.
                    </span>
                    {rec}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
