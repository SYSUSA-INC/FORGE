import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusPill } from "@/components/ui/StatusPill";
import { Funnel, FunnelLegend } from "@/components/ui/Funnel";
import { PieChart, PieLegend, type PieSlice } from "@/components/ui/PieChart";
import { BarMeter } from "@/components/ui/BarMeter";
import { DotMeter } from "@/components/ui/DotMeter";
import {
  opportunities,
  pipelineStages,
  historicalWinLoss,
} from "@/lib/pipeline";

const STAGE_COLORS: Record<number, string> = {
  0: "#C4B5FD",
  1: "#A78BFA",
  2: "#8B5CF6",
  3: "#7C3AED",
  4: "#D946EF",
  5: "#F5B544",
  6: "#34D399",
  7: "#FB7185",
};

export default function PipelinePage() {
  const totalValue = pipelineStages.reduce((a, s) => a + (s.valueHigh ?? 0), 0);
  const totalItems = pipelineStages.reduce((a, s) => a + s.count, 0);

  const slices: PieSlice[] = pipelineStages.map((s, i) => ({
    key: s.key,
    label: `Stage ${i + 1}: ${s.label}`,
    value: s.count,
    color: STAGE_COLORS[i],
  }));

  const winTotal = historicalWinLoss.reduce((a, w) => a + w.count, 0) || 1;

  return (
    <>
      <PageHeader
        eyebrow="Pipeline"
        title="Opportunity pipeline"
        subtitle="Track every opportunity from identification through submission. Filter by owner, source, or date range."
        actions={
          <>
            <button className="aur-btn">Refresh</button>
            <button className="aur-btn">Actions</button>
            <button className="aur-btn-primary">Add opportunity</button>
          </>
        }
        meta={[
          { label: "Items in pipeline", value: totalItems.toLocaleString() },
          {
            label: "Est. value (high)",
            value: totalValue >= 1_000_000_000
              ? `$${(totalValue / 1_000_000_000).toFixed(2)}B`
              : `$${(totalValue / 1_000_000).toFixed(0)}M`,
            accent: "emerald",
          },
          { label: "Weighted value", value: "$68.3M", accent: "gold" },
          { label: "Active cycle", value: "Stage 4", accent: "violet" },
        ]}
      />

      <div className="mb-6 aur-card p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[2fr_1fr_1fr_auto]">
          <div>
            <div className="aur-label">Show pipeline</div>
            <select className="aur-input">
              <option>My Company&apos;s Pipeline</option>
              <option>My Pipeline</option>
              <option>My Federal Ops</option>
              <option>My DIBBS</option>
              <option>My SBIR/STTR</option>
              <option>My State/Local Ops</option>
            </select>
          </div>
          <div>
            <div className="aur-label">Created from</div>
            <input type="date" className="aur-input" />
          </div>
          <div>
            <div className="aur-label">Created to</div>
            <input type="date" className="aur-input" />
          </div>
          <div className="flex items-end gap-2">
            <button className="aur-btn-primary">Apply</button>
            <button className="aur-btn">Clear</button>
          </div>
        </div>
      </div>

      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Panel eyebrow="Pipeline funnel" title="By stage">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_260px] lg:items-center">
            <div className="h-[460px]">
              <Funnel stages={pipelineStages} width={560} height={460} />
            </div>
            <FunnelLegend stages={pipelineStages} />
          </div>
        </Panel>

        <Panel eyebrow="Distribution" title="Pipeline by stage · share">
          <div className="grid grid-cols-[220px_1fr] items-center gap-4">
            <div className="h-[220px]">
              <PieChart slices={slices} />
            </div>
            <PieLegend slices={slices} />
          </div>

          <div className="mt-4 border-t border-white/10 pt-4">
            <div className="aur-label">116 watchlist items not in your pipeline</div>
            <div className="font-mono text-[12px] text-muted">
              Estimated value{" "}
              <span className="text-text">$67.9M – $60.2B</span>
            </div>
          </div>
        </Panel>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
        <Panel
          eyebrow="Opportunities"
          title={`Pipeline detail · 1 – ${opportunities.length} of 823`}
          actions={
            <div className="flex items-center gap-2 font-mono text-[11px] text-muted">
              <span>Filtered on Solicitation Number</span>
              <button className="aur-btn-ghost px-2 py-1 text-[11px]">Reset</button>
            </div>
          }
          dense
        >
          <ul className="divide-y divide-white/10">
            {opportunities.map((o) => {
              const stageIdx = pipelineStages.findIndex((s) => s.key === o.stage);
              const stageLabel = pipelineStages[stageIdx]?.label ?? "—";
              return (
                <li key={o.id}>
                  <Link
                    href={`/pipeline/${o.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-white/[0.03]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <StatusPill value={o.status.replace(/ /g, "_").toUpperCase()} />
                        <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
                          {o.source}
                        </span>
                        <span className="font-mono text-[10px] uppercase tracking-widest text-subtle">
                          · Stage {stageIdx + 1}
                        </span>
                      </div>
                      <div className="mt-1 font-display text-[15px] font-semibold text-text">
                        {o.title}
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-muted">
                        {o.solicitationNumber} · {o.agency} · advisor {o.pipelineAdvisor}
                      </div>
                      <div className="mt-2 grid grid-cols-[1fr_auto_auto] items-center gap-4">
                        <DotMeter
                          value={o.probability}
                          steps={24}
                          filled="bg-gradient-to-r from-violet to-magenta"
                        />
                        <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
                          Prob {o.probability}%
                        </span>
                        <span className="font-mono text-[10px] uppercase tracking-widest text-muted">
                          Due {o.responseDue}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
                        Pipeline value
                      </div>
                      <div className="font-display text-lg font-semibold text-text">
                        {o.pipelineValue === 0
                          ? "—"
                          : o.pipelineValue >= 1_000_000
                            ? `$${(o.pipelineValue / 1_000_000).toFixed(1)}M`
                            : `$${(o.pipelineValue / 1_000).toFixed(0)}K`}
                      </div>
                      <div className="mt-1 font-mono text-[10px] text-subtle">
                        {stageLabel}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>

        <aside className="flex flex-col gap-4">
          <Panel eyebrow="Summary" title="Pipeline summary list">
            <div className="font-mono text-[11px] text-muted">
              Filtered on <span className="text-text">Solicitation Number</span> · 0 matches
            </div>
            <div className="mt-3 border border-dashed border-white/10 p-3 text-[12px] text-muted">
              No items matched <span className="text-text">Solicitation Number</span>. Change
              your filter criteria and try again.
            </div>
          </Panel>

          <Panel eyebrow="Current win / loss" title="This quarter">
            <div className="flex items-center justify-between font-mono text-[11px] text-muted">
              <span>No wins or losses to display.</span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-[10px]">
              <WinStat k="Wins" v="0" />
              <WinStat k="Losses" v="0" />
              <WinStat k="Pending" v={String(pipelineStages[7].count)} />
            </div>
          </Panel>

          <Panel eyebrow="Historical" title="Outcomes (lifetime)">
            <ul className="flex flex-col gap-2">
              {historicalWinLoss.map((w) => {
                const pct = (w.count / winTotal) * 100;
                const tone =
                  w.key === "Won"
                    ? "emerald"
                    : w.key === "Lost"
                      ? "rose"
                      : w.key === "Responded"
                        ? "violet"
                        : w.key === "Cancelled"
                          ? "rose"
                          : "gold";
                return (
                  <li key={w.key}>
                    <div className="mb-1 flex items-center justify-between font-mono text-[11px]">
                      <span className="text-muted">{w.key}</span>
                      <span className="text-text tabular-nums">
                        {w.count} · {pct.toFixed(0)}%
                      </span>
                    </div>
                    <BarMeter
                      value={pct}
                      color={
                        tone === "emerald"
                          ? "emerald"
                          : tone === "rose"
                            ? "rose"
                            : tone === "violet"
                              ? "violet"
                              : "gold"
                      }
                    />
                  </li>
                );
              })}
            </ul>
          </Panel>
        </aside>
      </section>
    </>
  );
}

function WinStat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.03] p-2 text-center">
      <div className="text-[9px] uppercase tracking-widest text-muted">{k}</div>
      <div className="mt-0.5 font-display text-lg font-semibold tabular-nums">{v}</div>
    </div>
  );
}
