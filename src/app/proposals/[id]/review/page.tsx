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
        eyebrow={`Review · ${p.code}`}
        title="Review"
        subtitle="Pink Team → Red Team → Gold Team. Anchored comments resolve against source sections."
        actions={
          <>
            <button className="brut-btn">AI Red Team</button>
            <button className="brut-btn">Resolve all minor</button>
            <button className="brut-btn-hazard">Advance to Red Team</button>
          </>
        }
        meta={[
          { label: "Open", value: "14", accent: "blood" },
          { label: "Critical", value: "04", accent: "blood" },
          { label: "Resolved · 24h", value: "22", accent: "signal" },
          { label: "Current cycle", value: "Pink", accent: "hazard" },
        ]}
      />

      {/* Review cycle ribbon */}
      <div className="mb-6 grid grid-cols-3 border-2 border-ink shadow-brut">
        {(["PINK", "RED", "GOLD"] as const).map((cycle, i) => {
          const active = cycle === "PINK";
          return (
            <div
              key={cycle}
              className={`relative border-ink p-5 ${i !== 2 ? "border-r-2" : ""} ${
                cycle === "PINK"
                  ? "bg-[#FF80A8]"
                  : cycle === "RED"
                    ? "bg-blood text-paper"
                    : "bg-hazard"
              } ${active ? "" : "opacity-60"}`}
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.3em]">
                Cycle 0{i + 1}
              </div>
              <div className="mt-1 font-display text-3xl font-bold uppercase">
                {cycle.toLowerCase()} team
              </div>
              <div className="mt-2 font-mono text-[11px] uppercase tracking-wider">
                {cycle === "PINK"
                  ? "Internal team — draft quality"
                  : cycle === "RED"
                    ? "Government lens — compliance & win"
                    : "Leadership — final polish"}
              </div>
              <div className="mt-3">
                <BarMeter
                  value={cycle === "PINK" ? 58 : 0}
                  color={cycle === "RED" ? "blood" : "ink"}
                  right={active ? "In progress" : "Queued"}
                />
              </div>
              {active ? (
                <div className="absolute right-3 top-3 border-2 border-ink bg-paper px-2 py-0.5 font-mono text-[10px] font-bold text-ink">
                  Active
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_280px]">
        <Panel title="Comments · Pink cycle" dense>
          <div className="grid grid-cols-[90px_110px_110px_1fr_130px_120px] border-b-2 border-ink bg-ink font-mono text-[10px] uppercase tracking-[0.2em] text-paper">
            <div className="border-r border-paper/20 p-2">ID</div>
            <div className="border-r border-paper/20 p-2">Severity</div>
            <div className="border-r border-paper/20 p-2">Reviewer</div>
            <div className="border-r border-paper/20 p-2">Comment</div>
            <div className="border-r border-paper/20 p-2">Anchor</div>
            <div className="p-2">State</div>
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
                <div className="font-display text-sm font-bold">{c.section}</div>
                <p className="mt-0.5">{c.comment}</p>
              </div>
              <div className="border-r-2 border-ink p-3 font-mono text-[11px]">{c.anchor}</div>
              <div className="p-2">
                <button
                  className={`brut-btn w-full px-2 py-1 text-[10px] ${c.resolved ? "bg-signal" : ""}`}
                >
                  {c.resolved ? "Resolved" : "Resolve"}
                </button>
              </div>
            </div>
          ))}
        </Panel>

        <aside className="flex flex-col gap-4">
          <Panel title="Reviewers">
            <ul className="flex flex-col gap-2 font-mono text-[11px]">
              {[
                { i: "AB", n: "A. Brahms", r: "Lead", c: 18 },
                { i: "SD", n: "S. Doran", r: "Technical", c: 12 },
                { i: "MK", n: "M. Koenig", r: "Past performance", c: 7 },
                { i: "JV", n: "J. Vance", r: "Government lens", c: 4 },
              ].map((u) => (
                <li key={u.n} className="flex items-center gap-2 border-2 border-ink p-2">
                  <div className="grid h-9 w-9 place-items-center border-2 border-ink bg-ink font-mono text-xs font-bold text-paper">
                    {u.i}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-sm font-bold">{u.n}</div>
                    <div className="text-[10px] uppercase text-ink/60">
                      {u.r} · {u.c} comments
                    </div>
                  </div>
                  <span className="font-display text-xl font-bold leading-none">{u.c}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Burn-down · 7 days">
            <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest">
              <span>Open</span>
              <span className="font-bold">−36%</span>
            </div>
            <BarSpark data={[22, 24, 28, 26, 20, 18, 14]} color="bg-ink" />
            <div className="mt-3 mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest">
              <span>Resolved</span>
              <span className="font-bold">+1,100%</span>
            </div>
            <BarSpark data={[2, 6, 12, 18, 20, 24, 26]} color="bg-ink" />
            <div className="mt-3 flex items-center gap-3 font-mono text-[10px] uppercase tracking-widest">
              <span className="flex items-center gap-1">
                <span className="h-2 w-4 bg-ink" /> Open
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-4 bg-signal" /> Resolved
              </span>
            </div>
          </Panel>

          <Panel title="AI Red Team">
            <p className="font-mono text-[11px] leading-relaxed">
              Run Claude in <b>Government Evaluator</b> mode against the current draft.
              Produces simulated SSEB findings against Section M criteria.
            </p>
            <button className="brut-btn-hazard mt-3 w-full">Simulate SSEB</button>
            <div className="mt-2 font-mono text-[10px] uppercase text-ink/60">
              Last run · 2 days ago · 14 findings
            </div>
          </Panel>
        </aside>
      </div>
    </>
  );
}
