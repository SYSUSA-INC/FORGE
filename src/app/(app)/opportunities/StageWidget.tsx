"use client";

/**
 * One tile in the stage widget grid on /opportunities. Replaces the
 * old narrow chip row. Per spec, the short S1/S2/.../W/L/NB codes
 * are spelled out — capture stages become "Stage 1" through "Stage 7";
 * closed states show their full name (Won / Lost / No Bid).
 *
 * Click toggles the dashboard's stage filter. The active tile gets a
 * solid colored border + filled background so it reads as selected
 * even at a glance.
 */
export function StageWidget({
  shortLabel,
  descriptiveLabel,
  spellOut,
  count,
  color,
  dueProximity,
  pastDueCount,
  valueRange,
  active,
  onClick,
}: {
  /** "S1" / "W" / etc — kept as a small ribbon for power users. */
  shortLabel: string;
  /** "Identified", "Sources Sought / RFI", "Won"… */
  descriptiveLabel: string;
  /** "Stage 1", "Won"… the spelled-out form. */
  spellOut: string;
  count: number;
  color: string;
  /** Pre-formatted "due in 3 days" / "due today" etc., or null. */
  dueProximity: string | null;
  pastDueCount: number;
  /** Pre-formatted "$50k – $1.2M" totals across the stage, or null when
   *  every opportunity in the stage has no value range set. */
  valueRange: string | null;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`group flex flex-col gap-2 rounded-lg border bg-white/[0.02] p-3 text-left transition-colors ${
        active
          ? "border-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]"
          : "border-white/10 hover:border-white/30"
      }`}
      style={
        active
          ? {
              borderColor: color,
              backgroundColor: `${color}10`,
            }
          : undefined
      }
    >
      <div className="flex items-center justify-between">
        <div
          className="rounded-sm px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em]"
          style={{
            color,
            backgroundColor: `${color}1A`,
            border: `1px solid ${color}40`,
          }}
        >
          {shortLabel}
        </div>
        <div
          className="font-display text-2xl font-semibold leading-none tabular-nums"
          style={{ color: count > 0 ? "var(--text)" : "var(--muted)" }}
        >
          {count}
        </div>
      </div>

      <div className="flex flex-col">
        <div className="font-display text-[14px] font-semibold text-text leading-tight">
          {spellOut}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
          {descriptiveLabel}
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-1 font-mono text-[10px]">
        {valueRange ? (
          <span
            className="font-display text-[12px] font-medium tabular-nums"
            style={{ color: "var(--text)" }}
            title="Sum of opportunity value low–high across this stage"
          >
            {valueRange}
          </span>
        ) : null}
        {pastDueCount > 0 ? (
          <span className="inline-flex items-center gap-1 text-rose">
            <span aria-hidden>●</span>
            {pastDueCount} past due
          </span>
        ) : null}
        {dueProximity ? (
          <span className="text-amber-200">{dueProximity}</span>
        ) : count > 0 && !valueRange ? (
          <span className="text-subtle">no upcoming due dates</span>
        ) : null}
      </div>
    </button>
  );
}

// `spellOutStageCode` moved to ./stage-stats.ts so server
// components can import it. Re-exported here for backwards
// compatibility with any caller that imports it from this module.
export { spellOutStageCode } from "./stage-stats";
