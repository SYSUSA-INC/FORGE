import Link from "next/link";
import {
  formatDollars,
  type FunnelData,
  type FunnelStageStat,
} from "./funnel-stats";

/**
 * Pipeline funnel visualization. One trapezoid-ish row per active
 * stage (S1-S7); width tapers down toward the bottom because each
 * stage's max-width is clamped to the previous stage's actual size.
 *
 * The user-toggleable mode prop swaps the metric driving width:
 *   - "count" → bar width ∝ count of opportunities in that stage
 *   - "value" → bar width ∝ sum of PWin% × midpoint(valueLow, valueHigh)
 *
 * Each segment is a Link into /opportunities?stage=<key> so users
 * drill into the dashboard already filtered to that stage. Between
 * segments we render a small "↓ N%" annotation showing the
 * snapshot ratio of stage N+1 to stage N — useful for spotting
 * bottlenecks even though it's not a true historical conversion
 * rate (we don't yet capture stage history).
 *
 * Server component — no state. Toggle controls live in
 * `PipelineFilters.tsx` and rewrite the URL params that this
 * component reads through its props.
 */
export function PipelineFunnel({
  data,
  mode,
}: {
  data: FunnelData;
  mode: "count" | "value";
}) {
  // Find the largest metric value across active stages so we can
  // size every bar relative to that maximum (proper funnel scaling).
  const metricFor = (s: FunnelStageStat) =>
    mode === "value" ? s.weightedValue : s.count;
  const peak = Math.max(1, ...data.active.map(metricFor));

  return (
    <div className="flex flex-col">
      {data.active.map((stat, i) => {
        const value = metricFor(stat);
        const next = data.active[i + 1];
        const ratio =
          next && value > 0
            ? Math.round((metricFor(next) / value) * 100)
            : null;

        // Bar width: percentage of the peak value, with a floor of
        // 6% so even a count of 1 renders visibly.
        const widthPct = value === 0 ? 0 : Math.max(6, (value / peak) * 100);

        return (
          <div key={stat.key} className="flex flex-col">
            <Link
              href={`/opportunities?stage=${stat.key}`}
              className="group flex items-center gap-3 rounded-md py-2 transition-colors hover:bg-white/[0.02]"
            >
              <span
                className="w-44 shrink-0 truncate font-mono text-[11px] uppercase tracking-widest"
                style={{ color: stat.color }}
                title={stat.label}
              >
                {stat.shortLabel} · {stat.label}
              </span>
              <div className="relative h-9 flex-1 overflow-hidden rounded-md border border-white/10 bg-white/[0.02]">
                <div
                  className="absolute inset-y-0 left-0 transition-[width] duration-200"
                  style={{
                    width: `${widthPct}%`,
                    background: `linear-gradient(90deg, ${stat.color}55, ${stat.color}25)`,
                    borderRight:
                      stat.count > 0 ? `2px solid ${stat.color}` : undefined,
                  }}
                />
                <span className="absolute inset-y-0 left-3 flex items-center gap-2 font-mono text-[11px] tabular-nums text-text">
                  <span className="font-semibold">{stat.count}</span>
                  {mode === "value" ? (
                    <span className="text-muted">
                      · {formatDollars(stat.weightedValue)}
                    </span>
                  ) : null}
                </span>
              </div>
              <span className="w-12 shrink-0 text-right font-mono text-[10px] uppercase tracking-widest text-subtle group-hover:text-text">
                Drill →
              </span>
            </Link>

            {/* Conversion annotation — only between segments where a
                next-stage ratio makes sense (current-state count or
                value of stage N+1 divided by stage N). */}
            {ratio !== null ? (
              <div className="ml-44 flex items-center gap-2 pl-3 font-mono text-[10px] text-subtle">
                <span aria-hidden>↓</span>
                <span
                  title="Current-state ratio of next stage to this stage. Not a true historical conversion rate — we don't yet capture stage history."
                >
                  {ratio}%
                </span>
              </div>
            ) : null}
          </div>
        );
      })}

      {/* Outcome split: Won / Lost / No-bid. Rendered as horizontal
          bars sized against the peak active-stage metric so the
          visual weights stay comparable. */}
      {data.closed.length > 0 ? (
        <div className="mt-6 border-t border-white/10 pt-4">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.22em] text-subtle">
            Outcomes
            {data.winRate !== null ? (
              <span className="ml-2 text-muted">
                · win rate {data.winRate}%
              </span>
            ) : null}
          </div>
          <div className="flex flex-col gap-1">
            {data.closed.map((stat) => {
              const value = metricFor(stat);
              const widthPct =
                value === 0 ? 0 : Math.max(6, (value / peak) * 100);
              return (
                <Link
                  key={stat.key}
                  href={`/opportunities?stage=${stat.key}`}
                  className="group flex items-center gap-3 rounded-md py-1.5 transition-colors hover:bg-white/[0.02]"
                >
                  <span
                    className="w-44 shrink-0 truncate font-mono text-[11px] uppercase tracking-widest"
                    style={{ color: stat.color }}
                    title={stat.label}
                  >
                    {stat.shortLabel} · {stat.label}
                  </span>
                  <div className="relative h-7 flex-1 overflow-hidden rounded-md border border-white/10 bg-white/[0.02]">
                    <div
                      className="absolute inset-y-0 left-0 transition-[width] duration-200"
                      style={{
                        width: `${widthPct}%`,
                        background: `${stat.color}30`,
                        borderRight:
                          stat.count > 0
                            ? `2px solid ${stat.color}`
                            : undefined,
                      }}
                    />
                    <span className="absolute inset-y-0 left-3 flex items-center gap-2 font-mono text-[11px] tabular-nums text-text">
                      <span className="font-semibold">{stat.count}</span>
                      {mode === "value" ? (
                        <span className="text-muted">
                          · {formatDollars(stat.weightedValue)}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <span className="w-12 shrink-0 text-right font-mono text-[10px] uppercase tracking-widest text-subtle group-hover:text-text">
                    Drill →
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
