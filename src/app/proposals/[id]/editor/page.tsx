import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusPill } from "@/components/ui/StatusPill";
import { BarMeter } from "@/components/ui/BarMeter";
import { DotMeter } from "@/components/ui/DotMeter";
import { proposals, requirements, sections } from "@/lib/mock";

export default function EditorPage({ params }: { params: { id: string } }) {
  const proposal = proposals.find((p) => p.id === params.id) ?? proposals[0];

  return (
    <>
      <PageHeader
        eyebrow={`Editor · ${proposal.code} · Volume I · §3.2`}
        title="Editor"
        subtitle={`${proposal.title} — collaborative drafting with AI assistance.`}
        actions={
          <>
            <Link href={`/proposals/${proposal.id}/compliance`} className="brut-btn">
              Compliance
            </Link>
            <Link href={`/proposals/${proposal.id}/review`} className="brut-btn">
              Review
            </Link>
            <Link href={`/proposals/${proposal.id}/export`} className="brut-btn-hazard">
              Export
            </Link>
          </>
        }
        meta={[
          { label: "Progress", value: `${proposal.progress}%`, accent: "hazard" },
          { label: "Compliance", value: `${proposal.compliancePct}%`, accent: "signal" },
          { label: "Pages", value: `${proposal.pagesEstimated}/${proposal.pagesLimit}` },
          { label: "Days remaining", value: `${proposal.daysLeft}d`, accent: "blood" },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[260px_1fr_320px]">
        {/* OUTLINE */}
        <Panel title="Outline" code="TOC" dense>
          <ul>
            {sections.map((s, i) => (
              <li
                key={s.id}
                className={`relative flex items-center justify-between gap-2 border-b-2 border-ink/20 px-3 py-2 font-mono text-[11px] ${
                  i === 4 ? "bg-hazard font-bold" : "hover:bg-bone"
                }`}
              >
                {i === 4 ? (
                  <span className="absolute inset-y-0 left-0 w-1 bg-ink" />
                ) : null}
                <div className="min-w-0">
                  <div className="truncate">
                    <span className="text-ink/50">{s.number}</span> {s.title}
                  </div>
                  <div className="text-[9px] uppercase text-ink/60">
                    {s.volume} · {s.assignee} · p{s.pageEstimate}
                  </div>
                </div>
                <div
                  className={`shrink-0 border-2 border-ink px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                    s.status === "READY"
                      ? "bg-signal"
                      : s.status === "DRAFTING"
                        ? "bg-hazard"
                        : s.status === "IN_REVIEW"
                          ? "bg-blood text-paper"
                          : "bg-bone"
                  }`}
                >
                  {s.status.replace("_", " ")}
                </div>
              </li>
            ))}
          </ul>
          <div className="border-t-2 border-ink bg-bone p-3">
            <div className="brut-label">Volume progress</div>
            <BarMeter value={proposal.progress} color="ink" />
            <div className="mt-3">
              <div className="brut-label">AI contribution</div>
              <DotMeter value={proposal.aiPct} steps={20} filled="bg-ink" />
            </div>
          </div>
        </Panel>

        {/* EDITOR CANVAS */}
        <section className="brut-card overflow-hidden">
          <header className="flex items-center justify-between border-b-2 border-ink bg-ink px-4 py-2 text-paper">
            <div className="flex items-center gap-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em]">
              <span className="bg-paper px-1.5 py-0.5 text-ink">§</span>
              <span>3.2 · AI integration approach</span>
              <span className="brut-pill bg-signal text-ink">Saved</span>
            </div>
            <div className="flex items-center gap-2">
              <PresenceDot initials="AO" color="bg-blood" />
              <PresenceDot initials="KP" color="bg-hazard" />
              <PresenceDot initials="MR" color="bg-signal" />
              <span className="brut-pill bg-paper text-ink">3 online</span>
            </div>
          </header>

          {/* Toolbar */}
          <div className="flex items-center justify-between gap-2 border-b-2 border-ink bg-bone px-3 py-2">
            <div className="flex flex-wrap gap-1">
              {["B", "I", "U", "S"].map((t) => (
                <button
                  key={t}
                  className="h-8 w-8 border-2 border-ink bg-paper font-display text-sm font-bold shadow-brut-sm"
                >
                  {t}
                </button>
              ))}
              <div className="w-1" />
              {["H1", "H2", "¶"].map((t) => (
                <button
                  key={t}
                  className="h-8 min-w-8 border-2 border-ink bg-paper px-2 font-mono text-xs font-bold shadow-brut-sm"
                >
                  {t}
                </button>
              ))}
              <div className="w-1" />
              {["UL", "OL", "Quote", "Table", "Img", "Req"].map((t) => (
                <button
                  key={t}
                  className="h-8 border-2 border-ink bg-paper px-2 font-mono text-[10px] font-bold shadow-brut-sm"
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-ink/60">
              <span>12pt TNR · 1″ margins</span>
              <span>·</span>
              <span>6,120 words · p21</span>
            </div>
          </div>

          <article className="grid grid-cols-[36px_1fr_36px] font-body">
            <aside className="border-r-2 border-ink bg-bone/60 py-10 text-center font-mono text-[10px] text-ink/50">
              {Array.from({ length: 28 }, (_, i) => (
                <div key={i} className="leading-[1.6]">
                  {i + 1}
                </div>
              ))}
            </aside>

            <div className="px-8 py-10 text-[15px] leading-[1.6]">
              <div className="mb-4 border-b-2 border-ink pb-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-ink/60">
                  Volume I · Technical · §3.2
                </div>
                <h2 className="!font-display mt-1 text-3xl font-bold !normal-case leading-none tracking-tight">
                  AI Integration Approach
                </h2>
              </div>

              <p className="mt-4">
                <span className="bg-hazard px-1 font-mono text-[11px] uppercase">
                  [Req L.5.2.1]
                </span>{" "}
                SYSUSA will integrate AI/ML decision-support models into shipboard C5ISR
                systems using a four-layer reference architecture — edge inference, model
                governance, human-on-the-loop supervision, and operator telemetry — aligned
                with DoD Directive 3000.09 and NAVSEA&apos;s Integrated Warfighting Capability
                framework.
              </p>

              <div className="relative my-6 border-2 border-ink bg-bone p-4">
                <span className="absolute -top-3 left-3 border-2 border-ink bg-hazard px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest">
                  AI drafted · Sonnet 4.6 · 18 min ago
                </span>
                <span className="absolute -top-3 right-3 border-2 border-ink bg-paper px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest">
                  1,842 tokens
                </span>
                <p className="pt-2">
                  The{" "}
                  <u className="decoration-blood decoration-[3px] underline-offset-2">
                    latency budget
                  </u>{" "}
                  between sensor ingestion and recommended course-of-action is bounded at{" "}
                  <b>180 ms p95</b>, with a fail-safe revert to deterministic heuristics if
                  inference confidence falls below 0.62. A hardware-enforced kill-switch at the
                  Tactical Action Officer station satisfies the{" "}
                  <span className="bg-hazard px-0.5">human-on-the-loop</span> requirement of
                  L.5.2.1 and mitigates adversarial risk per Section M.3.1(a).
                </p>
                <div className="mt-3 flex gap-2">
                  <button className="brut-btn-primary px-3 py-1 text-[10px]">Accept</button>
                  <button className="brut-btn px-3 py-1 text-[10px]">Revise</button>
                  <button className="brut-btn px-3 py-1 text-[10px]">Expand</button>
                  <button className="brut-btn px-3 py-1 text-[10px]">Reject</button>
                </div>
              </div>

              <h3 className="!font-display mt-2 text-xl font-bold !normal-case">
                3.2.1 Architecture reference model
              </h3>
              <p className="mt-2">
                The reference model separates <i>Edge</i>, <i>Aggregation</i>, and{" "}
                <i>Command</i> tiers. Each model artifact is signed, versioned, and tracked in
                the SYSUSA Model Registry with immutable audit entries streamed to NAVSEA RMF
                repositories.
              </p>

              <div className="mt-4 border-2 border-ink">
                <div className="flex items-center justify-between border-b-2 border-ink bg-ink px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-paper">
                  <span>Table 3-1 · AI governance controls</span>
                  <span className="bg-blood px-1.5 py-0.5 text-[9px] text-paper">
                    9pt · fails L.6.1
                  </span>
                </div>
                <table className="w-full border-collapse font-mono text-[11px]">
                  <thead>
                    <tr className="bg-bone">
                      <th className="border-b-2 border-ink p-2 text-left">Control</th>
                      <th className="border-b-2 border-ink p-2 text-left">Standard</th>
                      <th className="border-b-2 border-ink p-2 text-left">Owner</th>
                      <th className="border-b-2 border-ink p-2 text-left">Frequency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["Model drift monitor", "NIST AI RMF 1.0", "MLOps Lead", "Continuous"],
                      ["Adversarial eval", "MITRE ATLAS", "Sec Research", "Weekly"],
                      ["Bias audit", "DoD 3000.09 §4.b", "AI Ethics Cell", "Monthly"],
                      ["HITL rules engine", "NAVSEA IWC v2", "TAO Integration", "Per sortie"],
                    ].map((row) => (
                      <tr key={row[0]} className="odd:bg-paper even:bg-bone/40">
                        {row.map((c, i) => (
                          <td key={i} className="border-b border-ink/20 p-2">
                            {c}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h3 className="!font-display mt-6 text-xl font-bold !normal-case">
                3.2.3 Model governance
              </h3>
              <div className="mt-2 border-2 border-dashed border-blood bg-blood/5 p-3">
                <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-blood">
                  <span className="inline-block h-2 w-2 bg-blood" />
                  Missing draft · Req M.3.1(a)
                </div>
                <p className="font-mono text-[12px]">
                  This subsection has not been drafted. It is referenced by Section M.3.1(a)
                  and is mandatory for compliance. AI can generate a first pass using
                  boilerplate <span className="bg-hazard px-0.5">KB-002</span> and capability{" "}
                  <span className="bg-hazard px-0.5">KB-006</span>.
                </p>
                <button className="brut-btn-blood mt-2 text-[10px]">Generate draft</button>
              </div>

              <p className="mt-6">
                Where Section M.3.1(a) evaluates{" "}
                <span className="bg-hazard px-0.5">model governance</span>, SYSUSA&apos;s
                approach binds each decision artifact to a deterministic chain from training
                data lineage through inference, supporting evidentiary review under CPARS and
                Inspector General inquiries.
              </p>
            </div>

            <aside className="border-l-2 border-ink bg-bone/40" />
          </article>

          <footer className="flex items-center justify-between border-t-2 border-ink bg-ink px-4 py-2 text-paper">
            <div className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-widest">
              <span>Live · Y.js</span>
              <span>6,120 w · 48.1 KB</span>
              <span>AI 61%</span>
            </div>
            <div className="flex items-center gap-2">
              <button className="brut-btn px-2 py-1 text-[10px]">History</button>
              <button className="brut-btn px-2 py-1 text-[10px]">Diff</button>
              <button className="brut-btn-primary px-2 py-1 text-[10px]">Commit</button>
            </div>
          </footer>
        </section>

        {/* AI + REQ PANEL */}
        <aside className="flex flex-col gap-4">
          <Panel title="AI generation" code="AI">
            <div className="mb-2 grid grid-cols-4 gap-1">
              {["Draft", "Revise", "Expand", "Trim"].map((t, i) => (
                <button
                  key={t}
                  className={`h-8 border-2 border-ink font-mono text-[10px] font-bold ${
                    i === 1 ? "bg-ink text-paper" : "bg-paper"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="brut-label">Prompt</div>
            <textarea
              rows={3}
              defaultValue={
                "Tighten paragraph 2 for evaluator clarity. Emphasize p95 latency and ATO enablement."
              }
              className="brut-input resize-none"
            />
            <div className="mt-3 flex flex-col gap-2 font-mono text-[11px]">
              <Toggle label="Use KB retrieval" on />
              <Toggle label="Enforce compliance" on />
              <Toggle label="Cite requirements" on />
              <Toggle label="Win themes" on={false} />
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="brut-chip bg-paper">Model · Sonnet 4.6</span>
              <button className="brut-btn-hazard">Generate</button>
            </div>
            <div className="mt-3 font-mono text-[10px] uppercase text-ink/60">
              Last run · 18 min ago · 1,842 tokens · 2.1 s
            </div>
          </Panel>

          <Panel title="Requirement trace" code="REQ">
            <ul className="flex flex-col gap-2">
              {requirements.slice(0, 4).map((r) => (
                <li key={r.id} className="border-2 border-ink bg-paper p-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] font-bold">{r.ref}</span>
                    <StatusPill value={r.compliance} />
                  </div>
                  <div className="mt-1 text-[12px] leading-snug">{r.text}</div>
                  <div className="mt-1 font-mono text-[10px] uppercase text-ink/60">
                    {r.category} · {r.assignee}
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="RAG context" code="KB">
            <ul className="flex flex-col gap-1 font-mono text-[11px]">
              {[
                { k: "KB-001", t: "LCS Mission Package — governance annex", d: 0.92 },
                { k: "KB-002", t: "ZTA implementation — ATO pattern", d: 0.88 },
                { k: "KB-006", t: "GovCloud platform — IL-5 boundary", d: 0.83 },
                { k: "KB-003", t: "Dr. Bray — CV excerpt (AI/ML)", d: 0.79 },
              ].map((h) => (
                <li key={h.k} className="border-b border-ink/20 py-1.5">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 truncate">{h.t}</div>
                    <span className="brut-chip bg-signal">{h.d.toFixed(2)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[9px] uppercase text-ink/60">{h.k}</span>
                    <DotMeter value={h.d * 100} steps={14} filled="bg-ink" />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>
    </>
  );
}

function PresenceDot({ initials, color }: { initials: string; color: string }) {
  return (
    <div
      className={`grid h-7 w-7 place-items-center border-2 border-paper font-mono text-[10px] font-bold text-paper ${color}`}
      title={initials}
    >
      {initials}
    </div>
  );
}

function Toggle({ label, on }: { label: string; on?: boolean }) {
  return (
    <label className="flex cursor-pointer items-center justify-between border-2 border-ink bg-paper px-2 py-1">
      <span className="uppercase tracking-widest">{label}</span>
      <span className={`relative h-4 w-8 border-2 border-ink ${on ? "bg-signal" : "bg-bone"}`}>
        <span
          className={`absolute top-0 h-full w-3 border-2 border-ink bg-ink transition-all ${
            on ? "left-[calc(100%-12px)]" : "left-0"
          }`}
        />
      </span>
    </label>
  );
}
