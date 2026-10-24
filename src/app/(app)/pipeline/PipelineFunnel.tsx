import Link from "next/link";
import { drillHref, type PipelineWindow } from "@/lib/pipeline-drill";
import {
  formatDollars,
  type FunnelData,
  type FunnelStageStat,
} from "./funnel-stats";

/**
 * The pipeline as a funnel (BL-PIPE-FUNNEL): one band per stage,
 * Identified at the top down to Won at the tip, with the stage's label
 * beside it. The bands narrow in even steps (the shape is the funnel,
 * not a chart); the numbers live in the labels: how many reached the
 * stage, the share of the previous stage that did, and how many sit
 * there now. A lost bid counts as having reached Submitted; a no-bid as
 * having left at Qualification (the same rule as Reports). Clicking a
 * band opens the dashboard filtered to that stage, in the page's window.
 *
 * Server component: the count/value toggle lives in PipelineFilters and
 * only changes the figure shown beside each segment.
 */
const SEG_H = 40;
/** Top and tip widths of the funnel, as a share of the drawing. */
const TOP_PCT = 100;
const TIP_PCT = 22;

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
  const stepW = (TOP_PCT - TIP_PCT) / Math.max(1, steps.length);
  const widthAt = (i: number) => TOP_PCT - i * stepW;

  return (
    <div className="flex flex-col">
      {steps.map((s, i) => {
        const prev = steps[i - 1];
        const next = steps[i + 1];
        const top = widthAt(i);
        // The last band comes to a point.
        const bottom = next ? widthAt(i + 1) : 0;
        const points = [
          `${50 - top / 2},0`,
          `${50 + top / 2},0`,
          `${50 + bottom / 2},${SEG_H}`,
          `${50 - bottom / 2},${SEG_H}`,
        ].join(" ");
        // Each band in its stage's own colour, the same one as its label's diamond.
        const fill = s.color;
        const figure =
          mode === "value"
            ? formatDollars(s.weightedValue)
            : `${s.count} here now`;
        return (
          <Link
            key={s.key}
            href={drillHref(window, null, s.key, mode)}
            className="group grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-4 px-1 py-[1px] transition-colors hover:bg-cobalt-400/[0.06] md:grid-cols-[320px_1fr]"
            title={`${s.label}: ${s.reached} reached this stage. Open them.`}
          >
            <svg
              viewBox={`0 0 100 ${SEG_H}`}
              preserveAspectRatio="none"
              className="h-10 w-full"
              aria-hidden
            >
              <polygon
                points={points}
                style={{ fill }}
                className="transition-opacity group-hover:opacity-80"
              />
              {/* A light rim along the top edge gives the band some depth. */}
              <ellipse
                cx="50"
                cy="0"
                rx={top / 2}
                ry="3"
                fill="rgb(255 255 255 / 0.28)"
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
