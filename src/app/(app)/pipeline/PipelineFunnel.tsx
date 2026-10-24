import Link from "next/link";
import { drillHref, type PipelineWindow } from "@/lib/pipeline-drill";
import {
  formatDollars,
  type FunnelData,
  type FunnelStageStat,
} from "./funnel-stats";
import { THEME, withAlpha } from "@/lib/theme-colors";

/**
 * The pipeline as a funnel (BL-PIPE-FUNNEL): one tapering segment per
 * stage, Identified at the top down to Won at the tip, with the stage's
 * label beside it. A segment's top edge is as wide as the number of
 * opportunities that reached that stage and its bottom edge as wide as
 * the number that reached the next, so the taper is the conversion. A
 * lost bid counts as having reached Submitted; a no-bid as having left
 * at Qualification (the same rule as Reports). Clicking a segment opens
 * the dashboard filtered to that stage, in the page's time window.
 *
 * Server component: the count/value toggle lives in PipelineFilters and
 * only changes the figure shown beside each segment.
 */
const SEG_H = 34;
const MIN_PCT = 10;

export function PipelineFunnel({
  data,
  mode,
  window = "all",
}: {
  data: FunnelData;
  mode: "count" | "value";
  /** The page's time window, kept when a stage opens its list (BL-PIPE-DRILL). */
  window?: PipelineWindow;
}) {
  const won = data.closed.find((s) => s.key === "won");
  const lost = data.closed.find((s) => s.key === "lost");
  const noBid = data.closed.find((s) => s.key === "no_bid");
  const steps: FunnelStageStat[] = won ? [...data.active, won] : data.active;
  const peak = Math.max(1, ...steps.map((s) => s.reached));
  const pct = (n: number) => Math.max(MIN_PCT, (n / peak) * 100);

  return (
    <div className="flex flex-col">
      {steps.map((s, i) => {
        const prev = steps[i - 1];
        const next = steps[i + 1];
        const top = pct(s.reached);
        const bottom = Math.min(top, next ? pct(next.reached) : top * 0.5);
        const points = [
          `${50 - top / 2},0`,
          `${50 + top / 2},0`,
          `${50 + bottom / 2},${SEG_H}`,
          `${50 - bottom / 2},${SEG_H}`,
        ].join(" ");
        // One hue, deepening down the funnel; Won is the success green.
        const fill =
          s.key === "won"
            ? THEME.green
            : withAlpha(THEME.cobalt, 0.3 + (i / Math.max(1, steps.length - 1)) * 0.6);
        const figure =
          mode === "value"
            ? formatDollars(s.weightedValue)
            : `${s.count} here now`;
        return (
          <Link
            key={s.key}
            href={drillHref(window, null, s.key, mode)}
            className="group grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-4 px-1 py-[2px] transition-colors hover:bg-cobalt-400/[0.06] md:grid-cols-[320px_1fr]"
            title={`${s.label}: ${s.reached} reached this stage. Open them.`}
          >
            <svg
              viewBox={`0 0 100 ${SEG_H}`}
              preserveAspectRatio="none"
              className="h-9 w-full"
              aria-hidden
            >
              <polygon
                points={points}
                fill={fill}
                className="transition-opacity group-hover:opacity-80"
              />
            </svg>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <span
                aria-hidden
                className="hidden h-px w-6 shrink-0 border-t border-dotted border-layer/40 md:block"
              />
              <span className="aur-tag">
                <span
                  aria-hidden
                  className="inline-block h-1.5 w-1.5 flex-none rotate-45"
                  style={{ backgroundColor: s.color }}
                />
                {s.label}
                <span className="ml-1 tabular-nums text-text">{s.reached}</span>
              </span>
              <span className="font-mono text-[10px] text-muted">
                {s.conversion !== null && prev
                  ? `${Math.round(s.conversion * 100)}% of ${prev.label}`
                  : "reached"}
                {" · "}
                {figure}
              </span>
            </div>
          </Link>
        );
      })}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-layer/10 pt-3 font-mono text-[11px] text-muted">
        <span>
          Win rate{" "}
          <span className="tabular-nums text-text">
            {data.winRate !== null ? `${data.winRate}%` : "—"}
          </span>
        </span>
        {[won, lost, noBid].map((s) =>
          s ? (
            <Link
              key={s.key}
              href={drillHref(window, null, s.key, mode)}
              className="hover:text-text"
            >
              {s.label.toLowerCase()}{" "}
              <span className="tabular-nums text-text">{s.count}</span>
            </Link>
          ) : null,
        )}
        <Link
          href="/intelligence/losses"
          className="ml-auto text-accent hover:underline"
        >
          Lessons from lost bids →
        </Link>
      </div>
    </div>
  );
}
