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
        eyebrow={`${proposal.code} · Volume I · §3.2`}
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
            <Link href={`/proposals/${proposal.id}/export`} className="brut-btn-primary">
              Export
            </Link>
          </>
        }
        meta={[
          { label: "Progress", value: `${proposal.progress}%` },
          { label: "Compliance", value: `${proposal.compliancePct}%`, accent: "signal" },
          { label: "Pages", value: `${proposal.pagesEstimated}/${proposal.pagesLimit}` },
          { label: "Days remaining", value: `${proposal.daysLeft}d`, accent: "blood" },
        ]}
      />

      {/* Document metadata bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-2 border-ink bg-bone px-4 py-2 font-mono text-[11px] text-ink/70">
        <span className="flex items-center gap-4">
          <span>
            Section{" "}
            <span className="font-bold text-ink">3.2 AI Integration Approach</span>
          </span>
          <span className="text-ink/40">·</span>
          <span>Assigned to <span className="font-bold text-ink">A. Okafor</span></span>
          <span className="text-ink/40">·</span>
          <span>Last saved <span className="font-bold text-ink">00:04 ago</span></span>
        </span>
        <span className="flex items-center gap-3">
          <span>12 pt TNR · 1″ margins</span>
          <span className="text-ink/40">·</span>
          <span>6,120 words · p 21</span>
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[260px_1fr_320px]">
        {/* OUTLINE */}
        <Panel title="Outline" dense>
          <ul>
            {sections.map((s, i) => (
              <li
                key={s.id}
                className={`relative flex items-center justify-between gap-2 border-b border-ink/15 px-3 py-2 font-mono text-[11px] transition-colors ${
                  i === 4 ? "bg-bone font-bold" : "hover:bg-bone/60"
                }`}
              >
                {i === 4 ? (
                  <span className="absolute inset-y-0 left-0 w-1 bg-hazard" />
                ) : null}
                <div className="min-w-0">
                  <div className="truncate">
                    <span className="tabular-nums text-ink/50">{s.number}</span>{" "}
                    <span className="text-ink">{s.title}</span>
                  </div>
                  <div className="text-[9px] uppercase tracking-wider text-ink/60">
                    {s.volume} · {s.assignee} · p{s.pageEstimate}
                  </div>
                </div>
                <SectionStatus status={s.status} />
              </li>
            ))}
          </ul>
          <div className="border-t-2 border-ink bg-paper p-3">
            <div className="brut-label">Volume progress</div>
            <BarMeter value={proposal.progress} color="ink" />
            <div className="mt-3">
              <div className="brut-label">AI contribution</div>
              <DotMeter value={proposal.aiPct} steps={20} filled="bg-ink" />
              <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-ink/60">
                <span>Audit logged</span>
                <span className="font-bold tabular-nums">{proposal.aiPct}%</span>
              </div>
            </div>
          </div>
        </Panel>

        {/* EDITOR CANVAS */}
        <section className="brut-card overflow-hidden">
          <header className="flex items-center justify-between border-b-2 border-ink bg-paper px-4 py-2">
            <div className="flex items-center gap-3 font-mono text-[11px] font-bold uppercase tracking-[0.18em]">
              <span className="border-2 border-ink bg-ink px-1.5 py-0.5 text-paper">§</span>
              <span>3.2 · AI Integration Approach</span>
              <span className="border-2 border-ink bg-signal px-2 py-0.5 font-mono text-[10px] font-bold text-ink">
                Saved
              </span>
            </div>
            <div className="flex items-center gap-2">
              <PresenceDot initials="AO" color="bg-ink" />
              <PresenceDot initials="KP" color="bg-ink" />
              <PresenceDot initials="MR" color="bg-ink" />
              <span className="brut-pill bg-paper text-ink">3 online</span>
            </div>
          </header>

          {/* Toolbar */}
          <div className="flex items-center justify-between gap-2 border-b-2 border-ink bg-bone px-3 py-2">
            <div className="flex flex-wrap items-center gap-1">
              <ToolbarGroup>
                <TB>B</TB>
                <TB>I</TB>
                <TB>U</TB>
                <TB>S</TB>
              </ToolbarGroup>
              <Divider />
              <ToolbarGroup>
                <TB wide>H1</TB>
                <TB wide>H2</TB>
                <TB wide>¶</TB>
              </ToolbarGroup>
              <Divider />
              <ToolbarGroup>
                <TB wide>UL</TB>
                <TB wide>OL</TB>
                <TB wide>Quote</TB>
                <TB wide>Table</TB>
                <TB wide>Image</TB>
                <TB wide>Req</TB>
              </ToolbarGroup>
            </div>
            <div className="flex items-center gap-2 font-mono text-[10px] text-ink/60">
              <span>Last edit 00:04 ago</span>
            </div>
          </div>

          <article className="grid grid-cols-[36px_1fr_36px] font-body">
            <aside className="border-r border-ink/20 bg-bone/40 py-10 text-center font-mono text-[10px] tabular-nums text-ink/50">
              {Array.from({ length: 28 }, (_, i) => (
                <div key={i} className="leading-[1.6]">
                  {i + 1}
                </div>
              ))}
            </aside>

            <div className="px-10 py-10 text-[15px] leading-[1.65] text-ink">
              <div className="mb-4 border-b-2 border-ink pb-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/60">
                  Volume I · Technical · §3.2
                </div>
                <h2 className="!font-display mt-1 text-3xl font-bold !normal-case leading-none tracking-tight">
                  AI Integration Approach
                </h2>
              </div>

              <p>
                <span className="border-2 border-ink bg-hazard px-1 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider">
                  Req L.5.2.1
                </span>{" "}
                SYSUSA will integrate AI/ML decision-support models into shipboard C5ISR
                systems using a four-layer reference architecture — edge inference, model
                governance, human-on-the-loop supervision, and operator telemetry — aligned
                with DoD Directive 3000.09 and NAVSEA&apos;s Integrated Warfighting Capability
                framework.
              </p>

              <div className="relative my-6 border-2 border-ink bg-paper p-4">
                <div className="mb-2 flex items-center justify-between border-b border-ink/20 pb-2 font-mono text-[10px] uppercase tracking-wider text-ink/70">
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 bg-ink" />
                    AI generated · Sonnet 4.6 · 18 min ago
                  </span>
                  <span className="tabular-nums">1,842 tokens · 2.1 s</span>
                </div>
                <p>
                  The{" "}
                  <u className="decoration-ink decoration-[2px] underline-offset-2">
                    latency budget
                  </u>{" "}
                  between sensor ingestion and recommended course-of-action is bounded at{" "}
                  <b>180 ms p95</b>, with a fail-safe revert to deterministic heuristics if
                  inference confidence falls below 0.62. A hardware-enforced kill-switch at
                  the Tactical Action Officer station satisfies the{" "}
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
                <i>Command</i> tiers. Each model artifact is signed, versioned, and tracked
                in the SYSUSA Model Registry with immutable audit entries streamed to NAVSEA
                RMF repositories.
              </p>

              <div className="mt-4 border-2 border-ink">
                <div className="flex items-center justify-between border-b-2 border-ink bg-ink px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-paper">
                  <span>Table 3-1 · AI governance controls</span>
                  <span className="flex items-center gap-1 border border-paper/40 bg-blood px-1.5 py-0.5 text-[9px] font-bold text-paper">
                    !  Font 9 pt fails L.6.1
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
                          <td key={i} className="border-b border-ink/15 p-2">
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
              <div className="mt-2 border-2 border-ink bg-bone p-3">
                <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-ink/70">
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 bg-blood" />
                    Not drafted · required by M.3.1(a)
                  </span>
                  <span className="border border-ink bg-paper px-1.5 py-0.5 text-[9px] font-bold text-ink">
                    Action required
                  </span>
                </div>
                <p className="mt-2 font-body text-[13px] leading-relaxed">
                  This subsection has not been drafted. It is referenced by Section M.3.1(a)
                  and is mandatory for compliance. FORGE can generate a first pass from
                  boilerplate <span className="bg-hazard px-0.5">KB-002</span> and capability{" "}
                  <span className="bg-hazard px-0.5">KB-006</span>.
                </p>
                <div className="mt-3 flex gap-2">
                  <button className="brut-btn-primary px-3 py-1 text-[10px]">
                    Generate draft
                  </button>
                  <button className="brut-btn px-3 py-1 text-[10px]">Assign</button>
                </div>
              </div>

              <p className="mt-6">
                Where Section M.3.1(a) evaluates{" "}
                <span className="bg-hazard px-0.5">model governance</span>, SYSUSA&apos;s
                approach binds each decision artifact to a deterministic chain from training
                data lineage through inference, supporting evidentiary review under CPARS
                and Inspector General inquiries.
              </p>
            </div>

            <aside className="border-l border-ink/20 bg-bone/40" />
          </article>

          <footer className="flex items-center justify-between border-t-2 border-ink bg-paper px-4 py-2">
            <div className="flex items-center gap-4 font-mono text-[10px] text-ink/60">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 bg-signal" /> Live · Y.js
              </span>
              <span>6,120 words · 48.1 KB</span>
              <span>AI contribution 61%</span>
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
          <Panel title="AI assistant">
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
              defaultValue="Tighten paragraph 2 for evaluator clarity. Emphasize p95 latency and ATO enablement."
              className="brut-input resize-none"
            />

            <fieldset className="mt-3 border-2 border-ink p-2">
              <legend className="px-1 font-mono text-[10px] uppercase tracking-widest text-ink/60">
                Options
              </legend>
              <div className="flex flex-col gap-1 font-mono text-[11px]">
                <Toggle label="Use KB retrieval" on />
                <Toggle label="Enforce compliance" on />
                <Toggle label="Cite requirements" on />
                <Toggle label="Apply win themes" on={false} />
              </div>
            </fieldset>

            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="brut-chip bg-paper">Sonnet 4.6</span>
              <button className="brut-btn-primary flex-1 justify-center">
                Generate
              </button>
            </div>
            <div className="mt-2 font-mono text-[10px] text-ink/60">
              Last run: 18 min ago · 1,842 tokens · 2.1 s
            </div>
          </Panel>

          <Panel title="Requirement trace">
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

          <Panel title="Retrieved context">
            <ul className="flex flex-col gap-1 font-mono text-[11px]">
              {[
                { k: "KB-001", t: "LCS Mission Package — governance annex", d: 0.92 },
                { k: "KB-002", t: "ZTA implementation — ATO pattern", d: 0.88 },
                { k: "KB-006", t: "GovCloud platform — IL-5 boundary", d: 0.83 },
                { k: "KB-003", t: "Dr. Bray — CV excerpt (AI/ML)", d: 0.79 },
              ].map((h) => (
                <li key={h.k} className="border-b border-ink/15 py-1.5">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 truncate">{h.t}</div>
                    <span className="ml-2 font-bold tabular-nums">{h.d.toFixed(2)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[9px] uppercase tracking-wider text-ink/60">
                      {h.k}
                    </span>
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

function SectionStatus({ status }: { status: string }) {
  const map: Record<string, string> = {
    READY: "bg-signal",
    DRAFTING: "bg-hazard",
    IN_REVIEW: "bg-ink text-paper",
    ASSIGNED: "bg-bone",
  };
  const label =
    status === "READY"
      ? "Ready"
      : status === "DRAFTING"
        ? "Drafting"
        : status === "IN_REVIEW"
          ? "In review"
          : "Assigned";
  return (
    <div
      className={`shrink-0 border-2 border-ink px-1.5 py-0.5 text-[9px] font-bold ${map[status] ?? "bg-paper"}`}
    >
      {label}
    </div>
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

function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1">{children}</div>;
}

function Divider() {
  return <span className="mx-1 h-6 w-[2px] bg-ink/20" aria-hidden />;
}

function TB({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <button
      className={`h-8 border-2 border-ink bg-paper font-mono text-[11px] font-bold shadow-brut-sm transition-transform hover:-translate-y-0.5 ${
        wide ? "min-w-8 px-2" : "w-8"
      }`}
    >
      {children}
    </button>
  );
}

function Toggle({ label, on }: { label: string; on?: boolean }) {
  return (
    <label className="flex cursor-pointer items-center justify-between px-1 py-1">
      <span className="uppercase tracking-widest">{label}</span>
      <span
        className={`relative h-4 w-8 border-2 border-ink ${on ? "bg-ink" : "bg-paper"}`}
      >
        <span
          className={`absolute top-0 h-full w-3 border-2 border-ink bg-paper transition-all ${
            on ? "left-[calc(100%-12px)]" : "left-0"
          }`}
        />
      </span>
    </label>
  );
}
