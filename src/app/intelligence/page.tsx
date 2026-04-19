"use client";

import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { BarMeter } from "@/components/ui/BarMeter";
import { brainStore, summarize, useBrain } from "@/lib/intelligence";

const LOOP_STAGES = [
  {
    key: "capture",
    label: "Capture",
    description:
      "Every draft, revision, comment, win theme, and debrief is stored with context (agency, NAICS, section type, evaluator criterion).",
    color: "from-violet to-violet",
  },
  {
    key: "score",
    label: "Score",
    description:
      "An evaluator-mirror predicts how a draft section would score against Section M criteria. Trains on your own Pink / Red / Gold history.",
    color: "from-violet via-magenta to-magenta",
  },
  {
    key: "retrieve",
    label: "Retrieve",
    description:
      "pgvector retrieval plus a learned reranker weights past passages by outcome — winning sections in the same agency float to the top.",
    color: "from-magenta to-gold",
  },
  {
    key: "generate",
    label: "Generate",
    description:
      "Prompts are versioned and attributed. Every generation logs template version, retrieval set, tokens, and the human decision that followed.",
    color: "from-gold to-emerald",
  },
  {
    key: "feedback",
    label: "Feedback",
    description:
      "Win / loss + evaluator notes close the loop. Reranker, evaluator-mirror, and prompt library update overnight from the signal stream.",
    color: "from-emerald to-violet",
  },
];

export default function IntelligencePage() {
  const state = useBrain();
  const sum = summarize(state);

  return (
    <>
      <PageHeader
        eyebrow="Intelligence · Phase A"
        title="The FORGE brain"
        subtitle="A closed loop between every draft, review comment, and award outcome. Quality and speed compound as you ship more proposals."
        actions={
          <button
            type="button"
            className="aur-btn"
            onClick={() => {
              if (confirm("Clear all learning data?")) brainStore.clear();
            }}
          >
            Reset brain
          </button>
        }
        meta={[
          {
            label: "Corpus size",
            value: sum.corpusSize.toLocaleString(),
            accent: sum.corpusSize > 0 ? "violet" : undefined,
          },
          {
            label: "Outcomes",
            value: String(sum.outcomesCaptured).padStart(2, "0"),
            accent: sum.outcomesCaptured > 0 ? "emerald" : undefined,
          },
          {
            label: "Win rate",
            value: sum.outcomesCaptured === 0 ? "—" : `${Math.round(sum.winRate * 100)}%`,
            accent: sum.winRate > 0 ? "emerald" : undefined,
          },
          {
            label: "Patterns",
            value: String(sum.patternsDiscovered).padStart(2, "0"),
            accent: sum.patternsDiscovered > 0 ? "gold" : undefined,
          },
        ]}
      />

      <section className="mb-6">
        <Panel eyebrow="Architecture" title="Learning loop">
          <ol className="grid grid-cols-1 gap-3 md:grid-cols-5">
            {LOOP_STAGES.map((s, i) => (
              <li
                key={s.key}
                className="relative rounded-lg border border-white/10 bg-white/[0.02] p-4"
              >
                <div
                  className={`absolute -top-[1px] left-3 right-3 h-[2px] rounded-full bg-gradient-to-r ${s.color}`}
                  aria-hidden
                />
                <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted">
                  <span className="grid h-5 w-5 place-items-center rounded-full border border-white/10 bg-white/5 text-[10px] font-semibold text-text">
                    {i + 1}
                  </span>
                  {s.label}
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-muted">
                  {s.description}
                </p>
              </li>
            ))}
          </ol>
        </Panel>
      </section>

      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel eyebrow="Corpus" title="Captured artifacts">
          <BigStat
            value={String(sum.corpusSize)}
            label="Drafts, comments, win themes, debriefs"
          />
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-muted">
              <span>Embedding coverage</span>
              <span>{Math.round(sum.embeddingCoverage * 100)}%</span>
            </div>
            <BarMeter value={sum.embeddingCoverage * 100} />
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            Every write enqueues an embedding job. Coverage climbs as the background worker
            processes the stream.
          </p>
        </Panel>

        <Panel eyebrow="Evaluator mirror" title="Scoring model">
          <BigStat
            value={
              sum.corpusSize < 20
                ? "Warming up"
                : sum.corpusSize < 100
                  ? "Calibrating"
                  : "Ready"
            }
            label={`${sum.corpusSize} of 100 training samples`}
          />
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-muted">
              <span>Training readiness</span>
              <span>{Math.min(100, Math.round((sum.corpusSize / 100) * 100))}%</span>
            </div>
            <BarMeter
              value={Math.min(100, (sum.corpusSize / 100) * 100)}
              color="gold"
            />
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            Once 100 reviewed sections are captured, nightly jobs fit a classifier that
            predicts draft scores in the editor.
          </p>
        </Panel>

        <Panel eyebrow="Outcomes" title="Win / loss signal">
          <BigStat
            value={sum.outcomesCaptured === 0 ? "—" : `${Math.round(sum.winRate * 100)}%`}
            label={`${sum.outcomesCaptured} outcome${sum.outcomesCaptured === 1 ? "" : "s"} captured`}
          />
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-muted">
              <span>Signal rate</span>
              <span>{sum.signalsApplied.toLocaleString()}</span>
            </div>
            <BarMeter
              value={Math.min(100, sum.signalsApplied * 2)}
              color="emerald"
            />
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            Win → positive reward to every retrieval used. Loss → negative. The reranker
            updates on each decided bid.
          </p>
        </Panel>
      </section>

      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <Panel
          eyebrow="Prompt library"
          title="Versioned prompts with outcome attribution"
          dense
        >
          {state.prompts.length === 0 ? (
            <EmptyState
              line="No prompt runs yet."
              hint="Each AI generation will write a PromptVersion entry here with acceptance rate, edit distance, and review severity once the Editor's AI assistant is wired in."
            />
          ) : (
            <div className="divide-y divide-white/10">
              <div className="grid grid-cols-[160px_60px_1fr_120px_120px] border-b border-white/10 bg-white/[0.03] px-5 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
                <div>Template</div>
                <div>Ver</div>
                <div>Status</div>
                <div className="text-right">Acceptance</div>
                <div className="text-right">Runs</div>
              </div>
              {state.prompts.map((p) => (
                <div
                  key={p.id}
                  className="grid grid-cols-[160px_60px_1fr_120px_120px] items-center px-5 py-3 text-[13px]"
                >
                  <div className="font-mono text-[11px] text-text">{p.template}</div>
                  <div className="font-mono text-[11px] tabular-nums text-muted">
                    v{p.version}
                  </div>
                  <div>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                        p.status === "active"
                          ? "border-emerald/40 bg-emerald/15 text-emerald"
                          : p.status === "candidate"
                            ? "border-violet/40 bg-violet/15 text-violet"
                            : "border-white/15 bg-white/5 text-muted"
                      }`}
                    >
                      {p.status}
                    </span>
                  </div>
                  <div className="text-right font-mono text-[12px] tabular-nums text-text">
                    {Math.round(p.stats.acceptanceRate * 100)}%
                  </div>
                  <div className="text-right font-mono text-[12px] tabular-nums text-muted">
                    {p.stats.runs}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel eyebrow="Audit" title="Last 10 signals">
          {state.signals.length === 0 ? (
            <EmptyState
              line="No training signals yet."
              hint="Every Accept / Revise / Reject click in the Editor, every Pink Team comment, and every win or loss writes a signal here."
            />
          ) : (
            <ul className="flex flex-col divide-y divide-white/10">
              {state.signals.slice(0, 10).map((s) => (
                <li
                  key={s.id}
                  className="grid grid-cols-[auto_1fr_auto] items-center gap-2 py-2 font-mono text-[11px]"
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${s.positive ? "bg-emerald" : "bg-rose"}`}
                  />
                  <span className="truncate text-text">{s.source}</span>
                  <span className="tabular-nums text-muted">{s.weight.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <Panel eyebrow="Learned patterns" title="What the brain has concluded" dense>
        {state.patterns.length === 0 ? (
          <EmptyState
            line="No patterns yet — the brain needs data."
            hint="Patterns surface after at least 10 decided opportunities. Examples: 'NAVSEA wins correlate with explicit latency p95 claims', 'Two-page exec summaries outscore three', 'Pink Team CRITICAL comments on section 3.2 correlate with loss'."
          />
        ) : (
          <div className="divide-y divide-white/10">
            {state.patterns.map((p) => (
              <div key={p.id} className="px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-display text-[14px] font-semibold text-text">
                      {p.statement}
                    </div>
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted">
                      {p.scope.agency ?? "—"} · {p.scope.naics ?? "—"} ·{" "}
                      {p.evidenceCount} datapoints
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                        p.trend === "rising"
                          ? "border-emerald/40 bg-emerald/15 text-emerald"
                          : p.trend === "fading"
                            ? "border-rose/40 bg-rose/15 text-rose"
                            : "border-white/15 bg-white/5 text-muted"
                      }`}
                    >
                      {p.trend}
                    </span>
                    <div className="font-mono text-[10px] tabular-nums text-muted">
                      confidence {Math.round(p.confidence * 100)}%
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div className="mt-6 rounded-lg border border-dashed border-white/10 bg-white/[0.02] px-5 py-4 font-mono text-[11px] leading-relaxed text-muted">
        <span className="text-text">Phase A — plumbing.</span> The brain currently records to{" "}
        <code className="mx-1 rounded bg-white/5 px-1 text-text">localStorage</code> and the
        UI is stubbed. The Postgres + pgvector backend, the nightly training jobs, and the
        Editor&apos;s live predicted-score pill ship in Phase B.
      </div>
    </>
  );
}

function BigStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-display text-3xl font-semibold tabular-nums text-text">
        {value}
      </div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted">
        {label}
      </div>
    </div>
  );
}

function EmptyState({ line, hint }: { line: string; hint: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-white/10 px-4 py-4 text-[13px] text-muted">
      <span className="text-text">{line}</span>
      <span className="text-[12px] leading-relaxed">{hint}</span>
    </div>
  );
}
