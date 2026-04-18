import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusPill } from "@/components/ui/StatusPill";
import { StageStrip } from "@/components/ui/StageStrip";
import { BarMeter } from "@/components/ui/BarMeter";
import {
  opportunityById,
  opportunities,
  pipelineStages,
} from "@/lib/pipeline";

export default function OpportunityPage({ params }: { params: { id: string } }) {
  const opp = opportunityById[params.id] ?? opportunities[0];
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
        subtitle={`${opp.agency} · NAICS ${opp.naics} · advisor ${opp.pipelineAdvisor} · source ${opp.source}`}
        actions={
          <>
            <Link href="/pipeline" className="aur-btn">
              Back
            </Link>
            <button className="aur-btn">Actions</button>
            <button className="aur-btn">Compliance matrix</button>
            <button className="aur-btn-primary">Respond</button>
          </>
        }
        meta={[
          { label: "Response due", value: opp.responseDue, accent: "rose" },
          {
            label: "Approx. value",
            value:
              opp.estimatedValueHigh === 0
                ? "TBD"
                : opp.estimatedValueHigh >= 1_000_000_000
                  ? `$${(opp.estimatedValueHigh / 1_000_000_000).toFixed(1)}B`
                  : `$${(opp.estimatedValueHigh / 1_000_000).toFixed(1)}M`,
            accent: "emerald",
          },
          { label: "Probability", value: `${opp.probability}%`, accent: "gold" },
          { label: "Priority", value: opp.priority, accent: "violet" },
        ]}
      />

      <div className="mb-6 aur-card aur-ring p-5 shadow-glow">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
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
              <span className="font-semibold text-violet">{confidence}%</span>. Recommendation{" "}
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
            {opp.priorityNote ? (
              <p className="mt-2 max-w-3xl text-[13px] text-muted">{opp.priorityNote}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 text-right">
            <StatusPill value={opp.status.replace(/ /g, "_").toUpperCase()} />
            <div className="font-mono text-[11px] text-muted">
              Pipeline value
            </div>
            <div className="font-display text-2xl font-semibold text-text">
              {opp.pipelineValue === 0
                ? "$0"
                : opp.pipelineValue >= 1_000_000
                  ? `$${(opp.pipelineValue / 1_000_000).toFixed(1)}M`
                  : `$${(opp.pipelineValue / 1_000).toFixed(0)}K`}
            </div>
          </div>
        </div>
      </div>

      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[240px_1fr_280px]">
        <Panel eyebrow="Advisor actions" title={`Advisor · ${opp.pipelineAdvisor}`}>
          <ul className="flex flex-col gap-2 text-[13px]">
            <li>
              <button className="aur-btn-danger w-full justify-start">
                ✕ Remove from pipeline
              </button>
            </li>
            <li>
              <button
                className="aur-btn w-full justify-start"
                disabled={!prevStage}
              >
                ← Revert to {prevStage ? `Stage ${stageIndex}: ${prevStage.label}` : "—"}
              </button>
            </li>
            <li>
              <button
                className="aur-btn-primary w-full justify-start"
                disabled={!nextStage}
              >
                → Advance to {nextStage ? `Stage ${stageIndex + 2}: ${nextStage.label}` : "—"}
              </button>
            </li>
          </ul>
          <div className="mt-4 border-t border-white/10 pt-4">
            <div className="aur-label">Confidence</div>
            <div className="flex items-end gap-2">
              <div className="font-display text-3xl font-semibold text-text">
                {confidence}%
              </div>
            </div>
            <BarMeter
              value={confidence}
              color={
                confidence >= 75 ? "emerald" : confidence >= 40 ? "gold" : "rose"
              }
            />
            <div className="mt-1 font-mono text-[10px] text-muted">
              {completedCount} of {checklistItems.length} questions cleared
            </div>
          </div>
        </Panel>

        <Panel eyebrow="Process" title="Pipeline checklist" dense>
          <ol className="divide-y divide-white/10">
            {pipelineStages.map((s, i) => {
              const isCurrent = s.key === opp.stage;
              const isPast = i < stageIndex;
              return (
                <li key={s.key}>
                  <div
                    className={`flex items-center justify-between gap-3 px-5 py-3 ${
                      isCurrent ? "bg-white/[0.04]" : ""
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold ${
                          isCurrent
                            ? "bg-gradient-to-br from-violet via-magenta to-gold text-white"
                            : isPast
                              ? "bg-emerald/20 text-emerald"
                              : "bg-white/5 text-muted"
                        }`}
                      >
                        {isPast ? "✓" : i + 1}
                      </span>
                      <div>
                        <div
                          className={`font-display text-[13px] font-semibold ${
                            isCurrent ? "text-gold" : isPast ? "text-emerald" : "text-muted"
                          }`}
                        >
                          Stage {i + 1}: {s.label}
                        </div>
                        {isCurrent ? (
                          <div className="mt-0.5 font-mono text-[10px] text-muted">
                            {completedCount} / {checklistItems.length} complete
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <span className="font-mono text-[10px] uppercase tracking-widest text-subtle">
                      {isCurrent ? "Active" : isPast ? "Cleared" : "Queued"}
                    </span>
                  </div>

                  {isCurrent ? (
                    <ul className="border-t border-white/10 bg-white/[0.02] px-5 py-3">
                      {checklistItems.map((c) => (
                        <li
                          key={c.q}
                          className="group grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 py-1.5 text-[13px]"
                        >
                          <span className="text-gold">›</span>
                          <span className={c.done ? "text-text" : "text-muted"}>{c.q}</span>
                          <div className="flex items-center gap-1">
                            <button
                              className={`grid h-6 w-6 place-items-center rounded-md border text-[11px] ${
                                c.done
                                  ? "border-emerald/40 bg-emerald/20 text-emerald"
                                  : "border-white/10 text-subtle hover:border-emerald/40 hover:text-emerald"
                              }`}
                              aria-label="Mark complete"
                            >
                              ✓
                            </button>
                            <button
                              className="grid h-6 w-6 place-items-center rounded-md border border-white/10 text-[11px] text-subtle hover:border-rose/40 hover:text-rose"
                              aria-label="Mark failed"
                            >
                              ✕
                            </button>
                          </div>
                          <button className="font-mono text-[10px] uppercase tracking-widest text-muted hover:text-text">
                            Add note
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </Panel>

        <aside className="flex flex-col gap-4">
          <Panel eyebrow="Financials" title="Pipeline value">
            <div className="grid place-items-center py-2">
              <button
                className="grid h-28 w-28 place-items-center rounded-full text-center font-display text-sm font-semibold text-white shadow-glow"
                style={{
                  background:
                    "radial-gradient(circle at 30% 30%, #C4B5FD, #8B5CF6 60%, #6D28D9 100%)",
                }}
              >
                <span className="flex flex-col leading-tight">
                  <span className="text-xs font-mono uppercase tracking-[0.2em] opacity-90">
                    Set
                  </span>
                  <span className="text-2xl font-bold">$$$</span>
                </span>
              </button>
            </div>

            <dl className="mt-2 flex flex-col gap-2 font-mono text-[11px]">
              <Row k="Priority" v={opp.priority} />
              <Row
                k="Approx. value"
                v={
                  opp.estimatedValueHigh === 0
                    ? "—"
                    : `$${(opp.estimatedValueLow / 1_000_000).toFixed(1)}M – $${(opp.estimatedValueHigh / 1_000_000).toFixed(1)}M`
                }
              />
              <Row k="Probability" v={`${opp.probability}%`} />
              <Row
                k="Pipeline value"
                v={
                  opp.pipelineValue === 0
                    ? "$0"
                    : `$${(opp.pipelineValue / 1_000_000).toFixed(1)}M`
                }
              />
              <Row k="Response due" v={opp.responseDue} />
              <Row k="Estimated return" v={`${opp.probability}%`} />
            </dl>
          </Panel>

          <Panel eyebrow="Notes" title="Advisor notes">
            {opp.notes && opp.notes.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {opp.notes.map((n, i) => (
                  <li key={i} className="rounded-md border border-white/10 bg-white/[0.02] p-3 text-[13px]">
                    <div className="font-mono text-[10px] uppercase tracking-widest text-muted">
                      {n.author} · {n.at}
                    </div>
                    <p className="mt-1 text-text/90">{n.text}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-md border border-dashed border-white/10 p-3 text-[12px] text-muted">
                No advisor notes yet. Add one above as you work the checklist.
              </div>
            )}
          </Panel>
        </aside>
      </section>

      <Panel eyebrow="Final disposition" title="Close the loop on this opportunity">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { k: "Won", tone: "emerald" },
            { k: "Lost", tone: "rose" },
            { k: "Responded", tone: "violet" },
            { k: "Won't respond", tone: "gold" },
            { k: "Cancelled", tone: "rose" },
            { k: "Archive", tone: "muted" },
            { k: "Delete", tone: "rose" },
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-start gap-3 border-b border-white/10 py-1.5 last:border-0">
      <dt className="uppercase tracking-widest text-muted">{k}</dt>
      <dd className="font-semibold text-text">{v}</dd>
    </div>
  );
}
