import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusPill } from "@/components/ui/StatusPill";
import { StageStrip } from "@/components/ui/StageStrip";
import { BarMeter } from "@/components/ui/BarMeter";
import { opportunityById, pipelineStages } from "@/lib/pipeline";

export default function OpportunityPage({ params }: { params: { id: string } }) {
  const opp = opportunityById[params.id];
  if (!opp) notFound();

  const stageIndex = pipelineStages.findIndex((s) => s.key === opp.stage);
  const currentStage = pipelineStages[stageIndex];
  const prevStage = pipelineStages[stageIndex - 1];
  const nextStage = pipelineStages[stageIndex + 1];

  const checklistItems = currentStage.checklist.map((q) => ({
    q,
    done: opp.checklistProgress?.[q] ?? false,
  }));
  const completedCount = checklistItems.filter((c) => c.done).length;
  const confidence = Math.round(
    (completedCount / Math.max(1, checklistItems.length)) * 100,
  );
  const recommendation =
    confidence >= 75
      ? { label: "Pursue", tone: "emerald" as const }
      : confidence >= 40
        ? { label: "Evaluate", tone: "gold" as const }
        : { label: "Hold", tone: "rose" as const };

  return (
    <>
      <PageHeader
        eyebrow={`Opportunity · ${opp.solicitationNumber}`}
        title={opp.title}
        subtitle={`${opp.agency} · NAICS ${opp.naics} · advisor ${opp.pipelineAdvisor}`}
        actions={
          <>
            <Link href="/pipeline" className="aur-btn">
              Back
            </Link>
            <button className="aur-btn-primary">Respond</button>
          </>
        }
        meta={[
          { label: "Response due", value: opp.responseDue || "—", accent: "rose" },
          {
            label: "Approx. value",
            value:
              opp.estimatedValueHigh === 0
                ? "TBD"
                : `$${(opp.estimatedValueHigh / 1_000_000).toFixed(1)}M`,
            accent: "emerald",
          },
          { label: "Probability", value: `${opp.probability}%`, accent: "gold" },
          { label: "Priority", value: opp.priority, accent: "violet" },
        ]}
      />

      <div className="mb-6 aur-card aur-ring p-5 shadow-glow">
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.25em] text-muted">
          <span className="h-1.5 w-1.5 animate-pulseSoft rounded-full bg-gold" />
          Pipeline advisor · {opp.pipelineAdvisor}
        </div>
        <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-text">
          Current stage:{" "}
          <span className="font-semibold text-gold">
            Stage {stageIndex + 1}: {currentStage.label}
          </span>
          . Advisor confidence{" "}
          <span className="font-semibold text-violet">{confidence}%</span>.
          Recommendation{" "}
          <span
            className={`font-semibold ${
              recommendation.tone === "emerald"
                ? "text-emerald"
                : recommendation.tone === "gold"
                  ? "text-gold"
                  : "text-rose"
            }`}
          >
            {recommendation.label}
          </span>
          .
        </p>
      </div>

      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[240px_1fr]">
        <Panel eyebrow="Advisor actions" title="Move this opportunity">
          <ul className="flex flex-col gap-2 text-[13px]">
            <li>
              <button className="aur-btn-danger w-full justify-start">
                Remove from pipeline
              </button>
            </li>
            <li>
              <button className="aur-btn w-full justify-start" disabled={!prevStage}>
                ← Revert{prevStage ? ` to ${prevStage.label}` : ""}
              </button>
            </li>
            <li>
              <button className="aur-btn-primary w-full justify-start" disabled={!nextStage}>
                → Advance{nextStage ? ` to ${nextStage.label}` : ""}
              </button>
            </li>
          </ul>
          <div className="mt-4 border-t border-white/10 pt-4">
            <div className="aur-label">Confidence</div>
            <div className="font-display text-3xl font-semibold text-text">
              {confidence}%
            </div>
            <BarMeter
              value={confidence}
              color={confidence >= 75 ? "emerald" : confidence >= 40 ? "gold" : "rose"}
            />
            <div className="mt-1 font-mono text-[10px] text-muted">
              {completedCount} of {checklistItems.length} questions cleared
            </div>
          </div>
        </Panel>

        <Panel eyebrow="Process" title="Pipeline checklist">
          <ul className="flex flex-col gap-1.5">
            {checklistItems.map((c) => (
              <li
                key={c.q}
                className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-[13px]"
              >
                <span className={c.done ? "text-text" : "text-muted"}>{c.q}</span>
                <div className="flex items-center gap-1">
                  <button
                    className={`grid h-6 w-6 place-items-center rounded-md border text-[11px] ${
                      c.done
                        ? "border-emerald/40 bg-emerald/20 text-emerald"
                        : "border-white/10 text-subtle hover:border-emerald/40 hover:text-emerald"
                    }`}
                  >
                    ✓
                  </button>
                  <button className="grid h-6 w-6 place-items-center rounded-md border border-white/10 text-[11px] text-subtle hover:border-rose/40 hover:text-rose">
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </section>

      <Panel eyebrow="Final disposition" title="Close the loop">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { k: "Won", tone: "emerald" },
            { k: "Lost", tone: "rose" },
            { k: "Responded", tone: "violet" },
            { k: "Won't respond", tone: "gold" },
            { k: "Cancelled", tone: "rose" },
            { k: "Archive", tone: "muted" },
          ].map((d) => {
            const cls =
              d.tone === "emerald"
                ? "border-emerald/40 bg-emerald/10 text-emerald hover:bg-emerald/20"
                : d.tone === "rose"
                  ? "border-rose/40 bg-rose/10 text-rose hover:bg-rose/20"
                  : d.tone === "violet"
                    ? "border-violet/40 bg-violet/10 text-violet hover:bg-violet/20"
                    : d.tone === "gold"
                      ? "border-gold/40 bg-gold/10 text-gold hover:bg-gold/20"
                      : "border-white/10 bg-white/5 text-muted hover:bg-white/10";
            return (
              <button
                key={d.k}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-display text-sm font-semibold transition-colors ${cls}`}
              >
                {d.k}
              </button>
            );
          })}
        </div>
      </Panel>

      <section className="mt-6">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.25em] text-muted">
          Stage progression
        </div>
        <StageStrip
          stages={pipelineStages.map((s) => ({ key: s.key, label: s.label }))}
          activeKey={opp.stage}
        />
      </section>
    </>
  );
}
