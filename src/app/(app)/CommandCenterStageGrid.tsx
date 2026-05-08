import Link from "next/link";
import { STAGES } from "@/lib/opportunity-types";
import {
  formatDueProximity,
  spellOutStageCode,
  type StageStat,
} from "./opportunities/stage-stats";

/**
 * Read-only counterpart to the StageWidget grid on /opportunities.
 * Same visuals, same data (both pages source from
 * `getOrganizationSnapshot()` so the numbers can never disagree —
 * that's the whole point of BL-7), but each tile NAVIGATES instead
 * of filtering. The Command Center is for at-a-glance read; the
 * dashboard is for filter + drill-in.
 *
 * Server component — no state. The dashboard's filterable variant
 * stays a client component because of `useState` for the active
 * stage filter; here we don't need any of that.
 */
export function CommandCenterStageGrid({
  stageStats,
}: {
  stageStats: Record<string, StageStat>;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {/* Slot 0: navigate to the dashboard with no filter. */}
      <Link
        href="/opportunities"
        className="flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-left transition-colors hover:border-white/30"
      >
        <div className="flex items-center justify-between">
          <div className="rounded-sm border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em] text-muted">
            All
          </div>
          <span aria-hidden className="text-muted">→</span>
        </div>
        <div className="font-display text-[14px] font-semibold text-text leading-tight">
          Open dashboard
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
          Drill into the pipeline
        </div>
      </Link>

      {STAGES.map((s) => {
        const stat = stageStats[s.key] ?? {
          count: 0,
          soonestDue: null,
          pastDueCount: 0,
        };
        const dueDate = stat.soonestDue ? new Date(stat.soonestDue) : null;
        const dueProximity = formatDueProximity(dueDate);
        const spellOut = spellOutStageCode(s.shortLabel);

        return (
          <Link
            key={s.key}
            href={`/opportunities?stage=${s.key}`}
            className="group flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-3 text-left transition-colors hover:border-white/30"
          >
            <div className="flex items-center justify-between">
              <div
                className="rounded-sm px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.22em]"
                style={{
                  color: s.color,
                  backgroundColor: `${s.color}1A`,
                  border: `1px solid ${s.color}40`,
                }}
              >
                {s.shortLabel}
              </div>
              <div
                className="font-display text-2xl font-semibold leading-none tabular-nums"
                style={{
                  color: stat.count > 0 ? "var(--text)" : "var(--muted)",
                }}
              >
                {stat.count}
              </div>
            </div>

            <div className="flex flex-col">
              <div className="font-display text-[14px] font-semibold text-text leading-tight">
                {spellOut}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
                {s.label}
              </div>
            </div>

            <div className="mt-auto flex flex-col gap-1 font-mono text-[10px]">
              {stat.pastDueCount > 0 ? (
                <span className="inline-flex items-center gap-1 text-rose">
                  <span aria-hidden>●</span>
                  {stat.pastDueCount} past due
                </span>
              ) : null}
              {dueProximity ? (
                <span className="text-amber-200">{dueProximity}</span>
              ) : stat.count > 0 ? (
                <span className="text-subtle">no upcoming due dates</span>
              ) : null}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
