import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Funnel, FunnelLegend } from "@/components/ui/Funnel";
import { PieChart, PieLegend, type PieSlice } from "@/components/ui/PieChart";
import { pipelineStages, opportunities, historicalWinLoss } from "@/lib/pipeline";

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
  const totalItems = pipelineStages.reduce((a, s) => a + s.count, 0);
  const totalValueHigh = pipelineStages.reduce((a, s) => a + s.valueHigh, 0);
  const wonCount = historicalWinLoss.find((w) => w.key === "Won")?.count ?? 0;
  const decided = historicalWinLoss
    .filter((w) => ["Won", "Lost"].includes(w.key))
    .reduce((a, w) => a + w.count, 0);
  const winRate = decided === 0 ? 0 : Math.round((wonCount / decided) * 100);

  const slices: PieSlice[] = pipelineStages.map((s, i) => ({
    key: s.key,
    label: `Stage ${i + 1}: ${s.label}`,
    value: s.count,
    color: STAGE_COLORS[i],
  }));

  const hasData = totalItems > 0 || opportunities.length > 0;

  return (
    <>
      <PageHeader
        eyebrow="Pipeline"
        title="Opportunity pipeline"
        subtitle="Every opportunity from identification through submission. The 8-stage funnel template is always visible; counts fill in as opportunities move through."
        actions={
          <>
            <Link href="/solicitations/new" className="aur-btn">
              Ingest solicitation
            </Link>
            <Link href="/proposals/new" className="aur-btn-primary">
              + Add opportunity
            </Link>
          </>
        }
        meta={[
          { label: "Items in pipeline", value: totalItems.toLocaleString() },
          {
            label: "Est. value (high)",
            value:
              totalValueHigh === 0
                ? "—"
                : totalValueHigh >= 1_000_000_000
                  ? `$${(totalValueHigh / 1_000_000_000).toFixed(2)}B`
                  : `$${(totalValueHigh / 1_000_000).toFixed(0)}M`,
            accent: totalValueHigh > 0 ? "emerald" : undefined,
          },
          { label: "Historic win rate", value: decided === 0 ? "—" : `${winRate}%` },
          {
            label: "Active cycle",
            value: totalItems === 0 ? "—" : "Multi-stage",
          },
        ]}
      />

      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Panel eyebrow="Pipeline funnel" title="By stage">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_260px] lg:items-center">
            <div className="h-[460px]">
              <Funnel stages={pipelineStages} width={560} height={460} />
            </div>
            <FunnelLegend stages={pipelineStages} />
          </div>
          {!hasData ? (
            <div className="mt-4 rounded-md border border-dashed border-white/10 px-4 py-3 text-[13px] text-muted">
              The stage template is shown for reference. Add an opportunity or create
              a proposal to start populating the funnel.
            </div>
          ) : null}
        </Panel>

        <Panel eyebrow="Distribution" title="Pipeline by stage">
          <div className="grid grid-cols-[220px_1fr] items-center gap-4">
            <div className="h-[220px]">
              <PieChart slices={slices} />
            </div>
            <PieLegend slices={slices} />
          </div>
        </Panel>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
        <Panel
          eyebrow="Opportunities"
          title={`Pipeline detail · ${opportunities.length}`}
          dense
        >
          {opportunities.length === 0 ? (
            <div className="flex flex-col items-start gap-2 px-5 py-8 text-[13px] text-muted">
              <span>No opportunities yet.</span>
              <Link href="/proposals/new" className="aur-btn-ghost px-0 py-0 text-[12px]">
                Add the first one →
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-white/10">
              {opportunities.map((o) => (
                <li key={o.id}>
                  <Link
                    href={`/pipeline/${o.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-white/[0.03]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-display text-[15px] font-semibold text-text">
                        {o.title}
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-muted">
                        {o.solicitationNumber} · {o.agency}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <aside className="flex flex-col gap-4">
          <Panel eyebrow="Current win / loss" title="This quarter">
            <div className="rounded-md border border-dashed border-white/10 px-3 py-3 text-[12px] text-muted">
              No wins or losses to display yet.
            </div>
          </Panel>

          <Panel eyebrow="Historical" title="Outcomes (lifetime)">
            {historicalWinLoss.length === 0 ? (
              <div className="rounded-md border border-dashed border-white/10 px-3 py-3 text-[12px] text-muted">
                Outcomes will accrue as proposals close.
              </div>
            ) : (
              <ul className="flex flex-col gap-2 font-mono text-[11px]">
                {historicalWinLoss.map((w) => (
                  <li
                    key={w.key}
                    className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.02] px-3 py-2"
                  >
                    <span className="text-muted">{w.key}</span>
                    <span className="tabular-nums text-text">{w.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </aside>
      </section>
    </>
  );
}
