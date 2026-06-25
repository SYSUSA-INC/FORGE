"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import {
  getWinnerAnalysisAction,
  runWinnerAnalysisAction,
  type WinnerAnalysisRow,
} from "./winner-actions";

type DebriefSummary = {
  strengths: string;
  weaknesses: string;
  improvements: string;
};

/**
 * Phase 14f — Proposal-vs-winner analysis panel.
 *
 * Renders only on lost proposals where awardedToCompetitor is set.
 *
 * Layout:
 *  1. Agency feedback (from the official debrief — direct inputs, not AI).
 *  2. Competitor intelligence — AI-generated profile + recommendations.
 *
 * Gaps and Strengths come from the agency's own debrief record.
 * AI generates the competitor profile and forward-looking recommendations.
 */
export function WinnerAnalysisPanel({
  proposalId,
  outcomeType,
  awardedToCompetitor,
  debrief,
}: {
  proposalId: string;
  outcomeType: string | null;
  awardedToCompetitor: string;
  debrief: DebriefSummary | null;
}) {
  const router = useRouter();
  const [analysis, setAnalysis] = useState<WinnerAnalysisRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(false);

  const eligible = outcomeType === "lost";
  const hasCompetitor = awardedToCompetitor.trim().length > 0;
  const hasDebrief =
    debrief && (debrief.weaknesses.trim() || debrief.strengths.trim());

  useEffect(() => {
    if (!eligible) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const res = await getWinnerAnalysisAction(proposalId);
      if (cancelled) return;
      if (res.ok) setAnalysis(res.analysis);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [proposalId, eligible]);

  function runAnalysis() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await runWinnerAnalysisAction(proposalId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAnalysis(res.analysis);
      setNotice(
        `Analysis complete. ${res.competitorAwardsFound} USAspending award${res.competitorAwardsFound === 1 ? "" : "s"} found for the competitor.${res.analysis.stubbed ? " (stub mode)" : ""}`,
      );
      router.refresh();
    });
  }

  if (!eligible) return null;

  return (
    <Panel
      title="Winner analysis"
      eyebrow={
        analysis
          ? `AI profile generated ${new Date(analysis.updatedAt).toLocaleString()}${analysis.stubbed ? " · stub" : ""}`
          : "Agency feedback + competitive intelligence"
      }
      actions={
        <button
          type="button"
          onClick={runAnalysis}
          disabled={pending || !hasCompetitor}
          className="aur-btn aur-btn-primary text-[11px] disabled:opacity-60"
          title={
            !hasCompetitor
              ? "Set 'Awarded to' on the outcome (the winning competitor's name) before running."
              : analysis
                ? "Re-run with the latest debrief and competitor awards."
                : "Pull the competitor's USAspending profile and generate competitive recommendations."
          }
        >
          {pending
            ? "Analyzing…"
            : analysis
              ? "Re-run AI analysis"
              : "Run AI competitor analysis"}
        </button>
      }
    >
      {!hasCompetitor ? (
        <div className="rounded-md border border-amber-400/30 bg-amber-400/5 px-3 py-2 font-mono text-[11px] text-amber-200">
          Set <strong>Awarded to</strong> on the outcome panel above (the
          winning competitor&apos;s name) before running this analysis.
        </div>
      ) : null}

      {/* ── Agency Feedback (from debrief — source of truth for gaps/strengths) ── */}
      <div className="mt-4">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
          Agency feedback (from debrief)
        </div>
        {hasDebrief ? (
          <div className="space-y-3">
            {debrief!.weaknesses.trim() ? (
              <AgencySection
                label="Weaknesses cited by agency"
                tone="text-rose"
                body={debrief!.weaknesses}
              />
            ) : null}
            {debrief!.strengths.trim() ? (
              <AgencySection
                label="Strengths cited by agency"
                tone="text-emerald-300"
                body={debrief!.strengths}
              />
            ) : null}
            {debrief!.improvements.trim() ? (
              <AgencySection
                label="Suggested improvements"
                tone="text-amber-300"
                body={debrief!.improvements}
              />
            ) : null}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-white/10 px-3 py-3 font-mono text-[11px] text-muted">
            No debrief recorded yet. Record the agency&apos;s official feedback
            in the <strong>Debrief</strong> panel above — gaps and strengths
            should come from the agency, not the AI.
          </div>
        )}
      </div>

      {/* ── AI Competitive Analysis ── */}
      <div className="mt-5 border-t border-white/5 pt-4">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
          Competitive intelligence (AI)
        </div>
        <p className="font-body text-[12px] leading-relaxed text-muted">
          Pulls the competitor&apos;s recent USAspending awards to characterize
          their profile, then suggests forward-looking recommendations for the
          next bid.
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
        ) : !analysis ? (
          <div className="mt-3 rounded-md border border-dashed border-white/10 px-3 py-3 font-mono text-[11px] text-muted">
            {hasCompetitor
              ? `No AI analysis yet. Click "Run AI competitor analysis" above.`
              : "Once an outcome with the winning competitor is recorded, run the analysis here."}
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <AiSection
              label="Competitor profile"
              tone="text-foreground"
              body={analysis.winnerProfileSummary}
            />
            <AiSection
              label="Recommendations for next bid"
              tone="text-teal-300"
              body={analysis.recommendations}
            />

            {analysis.sourceUsaspending.length > 0 ? (
              <div className="border-t border-white/5 pt-3">
                <button
                  type="button"
                  onClick={() => setShowSources((v) => !v)}
                  className="font-mono text-[10px] uppercase tracking-[0.2em] text-subtle hover:text-foreground"
                >
                  {showSources ? "Hide" : "Show"}{" "}
                  {analysis.sourceUsaspending.length} USAspending source
                  {analysis.sourceUsaspending.length === 1 ? "" : "s"}
                </button>
                {showSources ? (
                  <ul className="mt-2 space-y-1">
                    {analysis.sourceUsaspending.map((a) => (
                      <li
                        key={a.piid}
                        className="font-mono text-[11px] leading-relaxed text-muted"
                      >
                        <span className="text-foreground">{a.piid}</span>
                        {" · "}
                        {a.agency}
                        {a.value ? ` · ${a.value}` : ""}
                        {a.periodStart && a.periodEnd
                          ? ` · ${a.periodStart} → ${a.periodEnd}`
                          : ""}
                        {a.description ? (
                          <div className="mt-0.5 text-subtle">
                            {a.description.slice(0, 240)}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Panel>
  );
}

function AgencySection({
  label,
  tone,
  body,
}: {
  label: string;
  tone: string;
  body: string;
}) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
      <div
        className={`mb-1 font-mono text-[10px] uppercase tracking-[0.18em] ${tone}`}
      >
        {label}
      </div>
      <div className="whitespace-pre-wrap font-body text-[13px] leading-relaxed text-foreground">
        {body}
      </div>
    </div>
  );
}

function AiSection({
  label,
  tone,
  body,
}: {
  label: string;
  tone: string;
  body: string;
}) {
  return (
    <div>
      <div
        className={`font-mono text-[10px] uppercase tracking-[0.2em] ${tone}`}
      >
        {label}
      </div>
      <div className="mt-1 whitespace-pre-wrap font-body text-[13px] leading-relaxed text-foreground">
        {body || "(no content)"}
      </div>
    </div>
  );
}
