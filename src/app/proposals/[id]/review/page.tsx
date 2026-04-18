import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusPill } from "@/components/ui/StatusPill";
import { BarMeter } from "@/components/ui/BarMeter";
import { BarSpark } from "@/components/ui/Sparkline";
import { proposals, reviewComments } from "@/lib/mock";

export default function ReviewPage({ params }: { params: { id: string } }) {
  const p = proposals.find((x) => x.id === params.id) ?? proposals[0];

  return (
    <>
      <PageHeader
        eyebrow={`RVW // ${p.code} · REVIEW CYCLE OPS`}
        title="REVIEW"
        subtitle="Pink Team → Red Team → Gold Team. Anchored comments resolve against source sections."
        barcode={`${p.code}-PINK`}
        stamp={{ label: "PINK CYCLE · LIVE", tone: "blood" }}
        actions={
          <>
            <button className="brut-btn">AI RED TEAM</button>
            <button className="brut-btn">RESOLVE ALL MINOR</button>
            <button className="brut-btn-hazard">ADVANCE → RED</button>
          </>
        }
        meta={[
          { label: "OPEN", value: "14", accent: "blood" },
          { label: "CRITICAL", value: "04", accent: "blood" },
          { label: "RESOLVED · 24H", value: "22", accent: "signal" },
          { label: "CYCLE", value: "PINK", accent: "hazard" },
        ]}
      />

      {/* Review cycle ribbon */}
      <div className="mb-6 grid grid-cols-3 border-2 border-ink shadow-brut-xl">
        {(["PINK", "RED", "GOLD"] as const).map((cycle, i) => {
          const active = cycle === "PINK";
          const done = false;
          return (
            <div
              key={cycle}
              className={`relative overflow-hidden border-ink p-5 ${i !== 2 ? "border-r-2" : ""} ${
                cycle === "PINK"
                  ? "bg-[#FF80A8]"
                  : cycle === "RED"
                    ? "bg-blood text-paper"
                    : "bg-hazard"
              } ${active ? "" : "opacity-60"}`}
            >
              {active ? (
                <div className="brut-scan pointer-events-none absolute inset-0" />
              ) : null}
              <div className="font-mono text-[10px] uppercase tracking-[0.3em]">
                CYCLE 0{i + 1}
              </div>
              <div className="brut-stencil mt-1 text-5xl leading-none">{cycle}</div>
              <div className="mt-2 font-mono text-[11px] uppercase tracking-wider">
                {cycle === "PINK"
                  ? "EVALUATE AS OWN TEAM · DRAFT QUALITY"
                  : cycle === "RED"
                    ? "EVALUATE AS GOV · COMPLIANCE & WIN"
                    : "EVALUATE AS LEADERSHIP · FINAL POLISH"}
              </div>
              <div className="mt-3">
                <BarMeter
                  value={cycle === "PINK" ? 58 : 0}
                  color={cycle === "RED" ? "blood" : "ink"}
                  right={active ? "IN PROGRESS" : done ? "DONE" : "QUEUED"}
                />
              </div>
              {active ? (
                <div className="absolute right-3 top-3 flex items-center gap-1 border-2 border-ink bg-paper px-2 py-0.5 font-mono text-[10px] font-bold text-ink">
                  <span className="h-1.5 w-1.5 animate-blink bg-blood" /> LIVE
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_280px]">
        <Panel title="COMMENTS · PINK CYCLE" code="CMT" accent="blood" dense>
          <div className="grid grid-cols-[90px_110px_110px_1fr_130px_120px] border-b-2 border-ink bg-ink font-mono text-[10px] uppercase tracking-[0.2em] text-paper">
            <div className="border-r border-paper/20 p-2">ID</div>
            <div className="border-r border-paper/20 p-2">SEVERITY</div>
            <div className="border-r border-paper/20 p-2">REVIEWER</div>
            <div className="border-r border-paper/20 p-2">COMMENT</div>
            <div className="border-r border-paper/20 p-2">ANCHOR</div>
            <div className="p-2">STATE</div>
          </div>
          {reviewComments.map((c, i) => (
            <div
              key={c.id}
              className={`grid grid-cols-[90px_110px_110px_1fr_130px_120px] border-b-2 border-ink ${
                i % 2 ? "bg-bone" : "bg-paper"
              } ${c.severity === "CRITICAL" && !c.resolved ? "ring-2 ring-inset ring-blood" : ""}`}
            >
              <div className="border-r-2 border-ink p-3 font-mono text-[11px] font-bold">
                {c.id}
              </div>
              <div className="border-r-2 border-ink p-3">
                <StatusPill value={c.severity} />
              </div>
              <div className="border-r-2 border-ink p-3 font-mono text-[11px]">
                <div className="font-bold">{c.reviewer}</div>
                <div className="text-[10px] text-ink/60">{c.age} ago</div>
              </div>
              <div className="border-r-2 border-ink p-3 text-sm leading-snug">
                <div className="font-display text-sm font-bold uppercase">{c.section}</div>
                <p className="mt-0.5">{c.comment}</p>
              </div>
              <div className="border-r-2 border-ink p-3 font-mono text-[11px]">{c.anchor}</div>
              <div className="p-2">
                <button
                  className={`brut-btn w-full px-2 py-1 text-[10px] ${c.resolved ? "bg-signal" : ""}`}
                >
                  {c.resolved ? "RESOLVED" : "RESOLVE"}
                </button>
              </div>
            </div>
          ))}
        </Panel>

        <aside className="flex flex-col gap-4">
          <Panel title="REVIEWERS" code="USR" accent="cobalt">
            <ul className="flex flex-col gap-2 font-mono text-[11px]">
              {[
                { i: "AB", n: "A. Brahms", r: "LEAD", c: 18, color: "bg-blood text-paper" },
                { i: "SD", n: "S. Doran", r: "TECH", c: 12, color: "bg-hazard" },
                { i: "MK", n: "M. Koenig", r: "PP", c: 7, color: "bg-signal" },
                { i: "JV", n: "J. Vance", r: "GOV LENS", c: 4, color: "bg-ink text-paper" },
              ].map((u) => (
                <li key={u.n} className="flex items-center gap-2 border-2 border-ink p-2">
                  <div
                    className={`grid h-9 w-9 place-items-center border-2 border-ink font-mono text-xs font-bold ${u.color}`}
                  >
                    {u.i}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-sm font-bold">{u.n}</div>
                    <div className="text-[10px] uppercase text-ink/60">
                      {u.r} · {u.c} comments
                    </div>
                  </div>
                  <span className="brut-stencil text-2xl leading-none">{u.c}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="BURN-DOWN · 7D" code="BRN" accent="hazard">
            <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest">
              <span>OPEN</span>
              <span className="font-bold">-36%</span>
            </div>
            <BarSpark data={[22, 24, 28, 26, 20, 18, 14]} color="bg-blood" />
            <div className="mt-3 mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest">
              <span>RESOLVED</span>
              <span className="font-bold">+1100%</span>
            </div>
            <BarSpark data={[2, 6, 12, 18, 20, 24, 26]} color="bg-signal" />

            <div className="mt-3 flex items-center gap-3 font-mono text-[10px] uppercase tracking-widest">
              <span className="flex items-center gap-1">
                <span className="h-2 w-4 bg-blood" /> OPEN
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-4 bg-signal" /> RESOLVED
              </span>
            </div>
          </Panel>

          <Panel title="AI RED TEAM" code="ARG" accent="blood">
            <p className="font-mono text-[11px] leading-relaxed">
              Run Claude in <b>Government Evaluator</b> mode against the current draft. Produces
              simulated SSEB findings against Section M criteria.
            </p>
            <button className="brut-btn-hazard mt-3 w-full">SIMULATE SSEB →</button>
            <div className="mt-2 font-mono text-[10px] uppercase text-ink/60">
              LAST RUN · 2D AGO · 14 findings
            </div>
            <div className="brut-diagonal-blood mt-3 h-2 border-2 border-ink" />
          </Panel>
        </aside>
      </div>
    </>
  );
}
