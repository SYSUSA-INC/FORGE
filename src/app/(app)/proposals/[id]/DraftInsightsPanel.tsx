import { Panel } from "@/components/ui/Panel";
import { getDraftInsightsAction } from "./draft-insights-actions";

const KIND_LABELS: Record<string, string> = {
  executive_summary: "Exec. Summary",
  technical: "Technical",
  management: "Management",
  past_performance: "Past Perf.",
  pricing: "Pricing",
  compliance: "Compliance",
};

function fractionBadge(fraction: number | null) {
  if (fraction === null) return null;
  const pct = Math.round(fraction * 100);
  const color =
    pct >= 70 ? "#10B981" : pct >= 40 ? "#FBBF24" : "#F87171";
  return (
    <span
      className="rounded px-1.5 py-0.5 font-mono text-[10px]"
      style={{
        color,
        backgroundColor: `${color}1A`,
        border: `1px solid ${color}40`,
      }}
    >
      {pct}%
    </span>
  );
}

export async function DraftInsightsPanel({
  proposalId,
}: {
  proposalId: string;
}) {
  const result = await getDraftInsightsAction(proposalId);
  if (!result.ok || result.data.totalDrafts === 0) return null;

  const { data } = result;

  return (
    <Panel
      title="AI Draft Insights"
      eyebrow={`${data.totalDrafts} draft${data.totalDrafts !== 1 ? "s" : ""} · ${data.resolvedDrafts} resolved`}
    >
      <div className="flex flex-col gap-3">
        {/* Overall retention score */}
        <div className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
          <span className="font-body text-[12px] text-muted">
            Overall AI content retained
          </span>
          <div className="flex items-center gap-2">
            {fractionBadge(data.overallAvgFraction)}
            <span className="font-mono text-[10px] text-subtle">
              avg across {data.resolvedDrafts} saved draft
              {data.resolvedDrafts !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {/* Per-section-kind breakdown */}
        {data.kindStats.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-subtle">
              By section type
            </span>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {data.kindStats.map((s) => (
                <div
                  key={s.sectionKind}
                  className="flex items-center justify-between gap-2 rounded border border-white/10 bg-white/[0.02] px-2 py-1.5"
                >
                  <span className="font-mono text-[10px] text-muted">
                    {KIND_LABELS[s.sectionKind] ?? s.sectionKind}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {fractionBadge(s.avgAcceptedFraction)}
                    <span className="font-mono text-[9px] text-subtle">
                      ×{s.draftCount}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* A/B stats */}
        {data.abComparisonCount > 0 ? (
          <div className="flex items-center justify-between rounded-md border border-teal/20 bg-teal/[0.03] px-3 py-2">
            <span className="font-body text-[12px] text-muted">
              A/B comparisons —{" "}
              <span className="font-mono">
                {data.abComparisonCount} comparison
                {data.abComparisonCount !== 1 ? "s" : ""}
              </span>
            </span>
            {data.abVariantBWinRate !== null ? (
              <span className="font-mono text-[10px] text-teal">
                alt. variant chosen{" "}
                {Math.round(data.abVariantBWinRate * 100)}% of the time
              </span>
            ) : null}
          </div>
        ) : null}

        <p className="font-body text-[11px] leading-relaxed text-subtle">
          Higher retention = AI drafts align more closely with your writing
          style and submission requirements. Use the A/B Compare button in the
          section editor to let the Brain compete with itself.
        </p>
      </div>
    </Panel>
  );
}
