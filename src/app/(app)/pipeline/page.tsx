import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Funnel, FunnelLegend } from "@/components/ui/Funnel";
import { PieChart, PieLegend, type PieSlice } from "@/components/ui/PieChart";
import { pipelineStages, opportunities, historicalWinLoss } from "@/lib/pipeline";

// Stage colors mirror Funnel STAGE_GRADIENTS (9 entries).
const STAGE_COLORS: Record<number, string> = {
  0: "#A5F3FC",
  1: "#67E8F9",
  2: "#2DD4BF",
  3: "#34D399",
  4: "#8B5CF6",
  5: "#EC4899",
  6: "#BE185D",
  7: "#F472B6",
  8: "#10B981", // Stage 9: Won
};

export default function PipelinePage() {
  const totalItems = pipelineStages.reduce((a, s) => a + s.count, 0);
  const totalValueHigh = pipelineStages.reduce((a, s) => a + s.valueHigh, 0);
  const wonStage = pipelineStages.find((s) => s.key === "S9_WON");
  const wonFromStages = wonStage?.count ?? 0;
  const wonHistoric = historicalWinLoss.find((w) => w.key === "Won")?.count ?? 0;
  const totalWon = wonFromStages + wonHistoric;
  const decided = historicalWinLoss
    .filter((w) => ["Won", "Lost"].includes(w.key))
    .reduce((a, w) => a + w.count, 0);
  const winRate = decided === 0 ? 0 : Math.round((wonHistoric / decided) * 100);

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
        subtitle="Nine stages from identification through award. The template is always visible; counts and values fill in as opportunities progress."
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
          {
            label: "Wins (Stage 9 + lifetime)",
            value: totalWon === 0 ? "—" : String(totalWon),
            accent: totalWon > 0 ? "emerald" : undefined,
          },
          {
            label: "Historic win rate",
            value: decided === 0 ? "—" : `${winRate}%`,
            accent: winRate >= 50 ? "emerald" : undefined,
          },
        ]}
      />

      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Panel eyebrow="Pipeline funnel" title="By stage">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px] lg:items-center">
            <div className="relative mx-auto aspect-[560/540] w-full max-w-[560px] overflow-hidden">
              <Funnel stages={pipelineStages} width={560} height={540} />
            </div>
            <FunnelLegend stages={pipelineStages} />
          </div>
          {!hasData ? (
            <div className="mt-4 rounded-md border border-dashed border-white/10 px-4 py-3 text-[13px] text-muted">
              The 9-stage template is shown for reference. Add an opportunity or create
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
          <Panel eyebrow="Stage 9 · Won" title="In-pipeline wins">
            <div className="flex items-end gap-3">
              <div className="font-display text-4xl font-semibold text-emerald">
                {wonFromStages}
              </div>
              <div className="pb-1 font-mono text-[11px] text-muted">
                opportunities in Stage 9
              </div>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              Wins that haven’t been archived yet. Once you capture CPARS baselines and
              retrospective notes, advance them to historical outcomes — the brain uses
              them as positive training signal.
            </p>
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
