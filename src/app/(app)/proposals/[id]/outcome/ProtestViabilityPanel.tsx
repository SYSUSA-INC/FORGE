"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import {
  getProtestCheckAction,
  runProtestCheckAction,
  type ProtestCheckRow,
} from "./protest-actions";
import type { ProtestGround, ProtestRiskTier } from "@/db/schema";

const TIER_LABEL: Record<ProtestRiskTier, string> = {
  none: "None",
  weak: "Weak",
  colorable: "Colorable",
  strong: "Strong",
};

const TIER_COLOR: Record<ProtestRiskTier, string> = {
  none: "#9BC9D9",
  weak: "#F59E0B",
  colorable: "#F97316",
  strong: "#EF4444",
};

const STRENGTH_COLOR: Record<ProtestGround["strength"], string> = {
  weak: "#F59E0B",
  colorable: "#F97316",
  strong: "#EF4444",
};

/**
 * BL-FB-WIN-PROTEST — Protest viability check panel.
 *
 * Renders only on lost proposals. Loads cached result via useEffect,
 * lets users re-run the analysis on demand.
 */
export function ProtestViabilityPanel({
  proposalId,
  outcomeType,
}: {
  proposalId: string;
  outcomeType: string | null;
}) {
  const router = useRouter();
  const [check, setCheck] = useState<ProtestCheckRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedGround, setExpandedGround] = useState<number | null>(null);

  const eligible = outcomeType === "lost";

  useEffect(() => {
    if (!eligible) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await getProtestCheckAction(proposalId);
      if (cancelled) return;
      if (res.ok) setCheck(res.check);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [proposalId, eligible]);

  function runCheck() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await runProtestCheckAction(proposalId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCheck(res.check);
      setNotice(
        `Analysis complete. Risk tier: ${TIER_LABEL[res.check.riskTier]}.${res.check.riskTier === "none" ? " No viable grounds identified from available debrief." : ""}${res.check.stubbed ? " (stub mode)" : ""}`,
      );
      router.refresh();
    });
  }

  if (!eligible) return null;

  const tier = check?.riskTier ?? "none";
  const tierColor = TIER_COLOR[tier];

  return (
    <Panel
      title="Protest viability"
      eyebrow={
        check
          ? `Analysis run ${new Date(check.createdAt).toLocaleString()}${check.stubbed ? " · stub" : ""}`
          : "GAO / COFC bid-protest viability check"
      }
      actions={
        <button
          type="button"
          onClick={runCheck}
          disabled={pending}
          className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
          title="Analyze debrief weaknesses against GAO protest grounds and controlling cases."
        >
          {pending
            ? "Analyzing…"
            : check
              ? "Re-run analysis"
              : "Run protest check"}
        </button>
      }
    >
      <p className="font-body text-[12px] leading-relaxed text-muted">
        Examines debrief weaknesses and evaluation criteria to surface specific
        GAO protest grounds. Only flags actionable grounds — not every loss
        produces a viable challenge. Not legal advice; consult counsel before
        filing.
      </p>

      {error ? (
        <div className="mt-3 rounded-md border border-rose/40 bg-rose/10 px-3 py-2 font-mono text-[11px] text-rose">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="mt-3 rounded-md border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 font-mono text-[11px] text-emerald">
          {notice}
        </div>
      ) : null}

      {!loaded ? (
        <div className="mt-3 font-mono text-[11px] text-subtle">Loading…</div>
      ) : !check ? (
        <div className="mt-3 rounded-md border border-dashed border-white/10 px-3 py-3 font-mono text-[11px] text-muted">
          No protest analysis yet. Click &quot;Run protest check&quot; above.
          For best results, record the official debrief first.
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {/* Risk tier badge + summary */}
          <div className="flex items-start gap-3">
            <span
              className="shrink-0 rounded px-2 py-1 font-mono text-[11px] uppercase tracking-widest"
              style={{
                color: tierColor,
                backgroundColor: `${tierColor}1A`,
                border: `1px solid ${tierColor}50`,
              }}
            >
              {TIER_LABEL[tier]}
            </span>
            <p className="font-body text-[13px] leading-relaxed text-foreground">
              {check.summary}
            </p>
          </div>

          {/* Grounds list */}
          {check.grounds.length > 0 ? (
            <div className="border-t border-white/5 pt-4">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
                Identified grounds ({check.grounds.length})
              </div>
              <ul className="space-y-2">
                {check.grounds.map((g, i) => {
                  const gc = STRENGTH_COLOR[g.strength];
                  const expanded = expandedGround === i;
                  return (
                    <li
                      key={i}
                      className="rounded-md border border-white/10 bg-white/[0.02]"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedGround(expanded ? null : i)
                        }
                        className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
                      >
                        <span
                          className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest"
                          style={{
                            color: gc,
                            backgroundColor: `${gc}1A`,
                            border: `1px solid ${gc}50`,
                          }}
                        >
                          {g.strength}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-[11px] text-foreground">
                            {g.groundType}
                          </div>
                          <div className="mt-0.5 font-body text-[12px] leading-relaxed text-muted">
                            {g.description}
                          </div>
                        </div>
                        <span className="shrink-0 font-mono text-[10px] text-subtle">
                          {expanded ? "▲" : "▼"}
                        </span>
                      </button>

                      {expanded && g.controllingCases.length > 0 ? (
                        <div className="border-t border-white/5 px-3 pb-3 pt-2">
                          <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-subtle">
                            Controlling cases
                          </div>
                          <ul className="space-y-2">
                            {g.controllingCases.map((c, ci) => (
                              <li key={ci} className="font-mono text-[11px]">
                                <div className="text-teal-300">{c.citation}</div>
                                <div className="mt-0.5 text-muted">
                                  {c.holding}
                                </div>
                                <div className="mt-0.5 text-subtle">
                                  {c.relevance}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {/* Disclaimer */}
          {check.summary ? (
            <div className="border-t border-white/5 pt-3">
              <p className="font-mono text-[10px] leading-relaxed text-subtle">
                {check.grounds.length > 0
                  ? "This is preliminary legal analysis only, not legal advice. Consult qualified bid-protest counsel before filing any protest. GAO protests must be filed within 10 days of the debriefing (FAR 33.103)."
                  : "Protest viability analysis complete. No actionable grounds identified from the available debrief record."}
              </p>
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
