import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusPill } from "@/components/ui/StatusPill";
import { BarMeter } from "@/components/ui/BarMeter";
import { proposals, reviewComments } from "@/lib/mock";

export default function ReviewPage({ params }: { params: { id: string } }) {
  const p = proposals.find((x) => x.id === params.id) ?? proposals[0];

  const open = reviewComments.filter((c) => !c.resolved).length;
  const critical = reviewComments.filter((c) => c.severity === "CRITICAL").length;

  return (
    <>
      <PageHeader
        eyebrow={`${p.code} · Review`}
        title="Review"
        subtitle="Pink, Red, and Gold review cycles. Anchored comments resolve against source sections."
        actions={
          <>
            <button className="brut-btn">AI Red Team</button>
            <button className="brut-btn">Resolve all minor</button>
            <button className="brut-btn-primary">Advance to Red Team</button>
          </>
        }
        meta={[
          { label: "Open", value: String(open).padStart(2, "0"), accent: "blood" },
          { label: "Critical", value: String(critical).padStart(2, "0"), accent: "blood" },
          { label: "Resolved · 24h", value: "22", accent: "signal" },
          { label: "Current cycle", value: "Pink" },
        ]}
      />

      {/* Data-freshness bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-2 border-ink bg-bone px-4 py-2 font-mono text-[11px] text-ink/70">
        <span>
          Cycle{" "}
          <span className="font-bold text-ink">Pink</span> opened{" "}
          <span className="font-bold text-ink">3 days ago</span> · 58% complete · owner{" "}
          <span className="font-bold text-ink">A. Brahms</span>
        </span>
        <span className="flex items-center gap-3">
          <span>
            Burn rate <span className="bg-signal px-1 font-bold text-ink">▼ −36% WoW</span>
          </span>
          <span className="text-ink/40">·</span>
          <span>Target: close cycle by EOD Apr 20</span>
        </span>
      </div>

      {/* Review cycle ribbon — restrained */}
      <div className="mb-6 grid grid-cols-3 border-2 border-ink shadow-brut">
        {(["PINK", "RED", "GOLD"] as const).map((cycle, i) => {
          const active = cycle === "PINK";
          const swatch =
            cycle === "PINK"
              ? "bg-[#FF80A8]"
              : cycle === "RED"
                ? "bg-blood"
                : "bg-hazard";
          return (
            <div
              key={cycle}
              className={`relative border-ink p-5 ${i !== 2 ? "border-r-2" : ""} ${
                active ? "bg-paper" : "bg-bone/50"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.25em] text-ink/60">
                  <span className={`h-3 w-3 border-2 border-ink ${swatch}`} />
                  Cycle 0{i + 1}
                </div>
                {active ? (
                  <div className="border-2 border-ink bg-paper px-2 py-0.5 font-mono text-[10px] font-bold">
                    In progress
                  </div>
                ) : (
                  <div className="font-mono text-[10px] uppercase tracking-widest text-ink/50">
                    Queued
                  </div>
                )}
              </div>
              <div className="mt-2 font-display text-2xl font-bold">
                {cycle.charAt(0) + cycle.slice(1).toLowerCase()} Team
              </div>
              <div className="mt-1 font-mono text-[11px] text-ink/70">
                {cycle === "PINK"
                  ? "Internal team — draft quality and self-check"
                  : cycle === "RED"
                    ? "Government lens — compliance and win strategy"
                    : "Leadership — final polish and sign-off"}
              </div>
              <div className="mt-4">
                <BarMeter
                  value={cycle === "PINK" ? 58 : 0}
                  color="ink"
                  right={cycle === "PINK" ? "58%" : "—"}
                />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-[10px]">
                <MiniStat k="Comments" v={cycle === "PINK" ? "14" : "—"} />
                <MiniStat k="Critical" v={cycle === "PINK" ? "04" : "—"} />
                <MiniStat k="Resolved" v={cycle === "PINK" ? "22" : "—"} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_280px]">
        <Panel title="Comments — Pink cycle" dense>
          <div className="grid grid-cols-[90px_110px_110px_1fr_120px_120px] border-b-2 border-ink bg-ink font-mono text-[10px] uppercase tracking-[0.2em] text-paper">
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
              className={`grid grid-cols-[90px_110px_110px_1fr_120px_120px] border-b-2 border-ink ${
                i % 2 ? "bg-bone" : "bg-paper"
              }`}
            >
              <div className="flex items-center border-r-2 border-ink p-3 font-mono text-[11px] font-bold tabular-nums">
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
                <p className="mt-0.5 text-ink/80">{c.comment}</p>
              </div>
              <div className="border-r-2 border-ink p-3 font-mono text-[11px] tabular-nums">
                {c.anchor}
              </div>
              <div className="p-2">
                <button
                  className={`brut-btn w-full px-2 py-1 text-[10px] ${
                    c.resolved ? "bg-signal text-ink" : ""
                  }`}
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
                    <div className="text-[10px] uppercase text-ink/60">{u.r}</div>
                  </div>
                  <div className="text-right font-mono text-[10px] uppercase text-ink/60">
                    <div className="font-display text-xl font-bold tabular-nums leading-none text-ink">
                      {u.c}
                    </div>
                    <div>comments</div>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Burn-down · 7 days">
            <BurnChart />
            <div className="mt-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-ink/60">
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-4 bg-ink" /> Open
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-2 w-4 bg-signal" /> Resolved
              </span>
            </div>
          </Panel>

          <Panel title="AI Red Team">
            <p className="font-mono text-[11px] leading-relaxed text-ink/80">
              Run Claude in <b>government evaluator</b> mode against the current draft. Produces
              simulated SSEB findings mapped to Section M criteria.
            </p>
            <button className="brut-btn-primary mt-3 w-full">Simulate SSEB</button>
            <div className="mt-2 font-mono text-[10px] text-ink/60">
              Last run: 2 days ago · 14 findings
            </div>
          </Panel>
        </aside>
      </div>
    </>
  );
}

function MiniStat({ k, v }: { k: string; v: string }) {
  return (
    <div className="border-2 border-ink bg-paper px-2 py-1">
      <div className="text-[9px] uppercase tracking-widest text-ink/60">{k}</div>
      <div className="font-display text-sm font-bold tabular-nums leading-none">{v}</div>
    </div>
  );
}

function BurnChart() {
  const open = [22, 24, 28, 26, 20, 18, 14];
  const resolved = [2, 6, 12, 18, 20, 24, 26];
  const max = Math.max(...open, ...resolved);
  return (
    <div className="border-2 border-ink bg-paper p-2">
      <div className="flex h-28 items-end gap-2">
        {open.map((o, i) => (
          <div key={i} className="flex flex-1 items-end gap-[2px]">
            <div
              className="flex-1 bg-ink"
              style={{ height: `${(o / max) * 100}%` }}
              title={`Open ${o}`}
            />
            <div
              className="flex-1 bg-signal"
              style={{ height: `${(resolved[i] / max) * 100}%` }}
              title={`Resolved ${resolved[i]}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-2 font-mono text-[9px] uppercase tracking-widest text-ink/60">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d} className="text-center">
            {d}
          </span>
        ))}
      </div>
    </div>
  );
}
