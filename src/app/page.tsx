import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusPill } from "@/components/ui/StatusPill";
import { BarMeter } from "@/components/ui/BarMeter";
import { Radar } from "@/components/ui/Radar";
import { HeatGrid } from "@/components/ui/HeatGrid";
import { Sparkline, BarSpark } from "@/components/ui/Sparkline";
import { GanttRow } from "@/components/ui/GanttRow";
import { DotMeter } from "@/components/ui/DotMeter";
import { proposals, solicitations, reviewComments } from "@/lib/mock";

export default function DashboardPage() {
  const activeProposals = proposals.filter((p) => p.status !== "SUBMITTED");
  const hottest = [...activeProposals].sort((a, b) => a.daysLeft - b.daysLeft)[0];

  return (
    <>
      <PageHeader
        eyebrow="Command"
        title="Command"
        subtitle="Capture operations, proposal velocity, and compliance deltas across the active pipeline."
        actions={
          <>
            <button className="brut-btn">Refresh</button>
            <Link href="/solicitations/new" className="brut-btn">
              New solicitation
            </Link>
            <Link href="/proposals/new" className="brut-btn-primary">
              New proposal
            </Link>
          </>
        }
        meta={[
          { label: "Active proposals", value: "04" },
          { label: "In review", value: "02" },
          { label: "Pipeline value", value: "$185M" },
          { label: "Next deadline", value: "2d 4h", accent: "blood" },
        ]}
      />

      {/* As-of bar — an enterprise trust signal */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-2 border-ink bg-bone px-4 py-2 font-mono text-[11px] tracking-wide text-ink/70">
        <span>
          Data as of{" "}
          <span className="font-bold text-ink">
            {new Date().toISOString().slice(0, 10)} · 14:02 UTC
          </span>
          . Streaming updates every 60 s.
        </span>
        <span className="flex items-center gap-3">
          <span>Owner: J. Calder</span>
          <span className="text-ink/40">·</span>
          <span>Org: SYSUSA</span>
          <span className="text-ink/40">·</span>
          <span>FY 2026 · Q2</span>
        </span>
      </div>

      {/* HERO ROW — priority proposal 2/3, radar + win prob stacked on right */}
      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        {/* Priority proposal */}
        <div className="border-2 border-ink bg-paper shadow-brut">
          <header className="flex items-center justify-between border-b-2 border-ink bg-paper px-4 py-2">
            <div className="flex items-center gap-3">
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-ink/70">
                Priority proposal
              </span>
              <span className="font-mono text-[10px] text-ink/50">
                {hottest?.code}
              </span>
            </div>
            <StatusPill value={hottest?.status ?? ""} />
          </header>

          <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-[1fr_auto]">
            <div>
              <div className="font-display text-2xl font-bold leading-tight">
                {hottest?.title}
              </div>
              <div className="mt-1 font-mono text-[11px] uppercase tracking-wider text-ink/60">
                {hottest?.solicitation} · {hottest?.agency}
              </div>

              <div className="mt-5 grid grid-cols-3 gap-4 font-mono text-[11px]">
                <KeyFact
                  label="Due in"
                  value={`${hottest?.daysLeft ?? 0}d`}
                  sub={hottest?.dueAt.split(" ")[0]}
                  emphasize="blood"
                />
                <KeyFact
                  label="Compliance"
                  value={`${hottest?.compliancePct}%`}
                  sub="Target ≥ 95%"
                />
                <KeyFact
                  label="Pages"
                  value={`${hottest?.pagesEstimated}`}
                  sub={`of ${hottest?.pagesLimit}`}
                />
              </div>

              <div className="mt-5 grid grid-cols-2 gap-2">
                <Link
                  href={`/proposals/${hottest?.id}/editor`}
                  className="brut-btn-primary w-full justify-center"
                >
                  Open editor
                </Link>
                <Link
                  href={`/proposals/${hottest?.id}/compliance`}
                  className="brut-btn w-full justify-center"
                >
                  View compliance
                </Link>
              </div>
            </div>

            <div className="hidden w-64 md:block">
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/60">
                Readiness by axis
              </div>
              <div className="mt-1 flex flex-col gap-1 font-mono text-[11px]">
                {[
                  ["Strategic fit", 82],
                  ["Technical", 68],
                  ["Past performance", 74],
                  ["Price", 54],
                  ["Staffing", 71],
                  ["Security", 88],
                ].map(([k, v]) => (
                  <AxisRow key={k as string} label={k as string} value={v as number} />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right column: radar + win-probability trend stacked */}
        <div className="flex flex-col gap-4">
          <Panel title="Capture readiness">
            <div className="h-[200px]">
              <Radar
                data={[
                  { label: "Strategic", value: 82 },
                  { label: "Technical", value: 68 },
                  { label: "PP", value: 74 },
                  { label: "Price", value: 54 },
                  { label: "Staffing", value: 71 },
                  { label: "Security", value: 88 },
                  { label: "Past wins", value: 61 },
                ]}
              />
            </div>
            <div className="mt-3 flex items-center justify-between border-t-2 border-ink pt-2 font-mono text-[11px]">
              <span className="text-ink/60">Weighted P(win)</span>
              <span className="font-display text-xl font-bold tabular-nums">54%</span>
            </div>
          </Panel>

          <Panel title="Win probability · 12 wk">
            <div className="h-14">
              <Sparkline
                data={[32, 38, 34, 41, 40, 47, 52, 49, 55, 51, 58, 54]}
                color="#0A0A0A"
                fill="#EDE5D3"
              />
            </div>
            <div className="mt-2 flex items-center justify-between border-t-2 border-ink pt-2 font-mono text-[11px]">
              <span className="text-ink/60">Current · trend</span>
              <span className="flex items-center gap-1.5">
                <span className="font-display text-xl font-bold tabular-nums">54%</span>
                <span className="bg-signal px-1 font-bold">▲ 6.2</span>
              </span>
            </div>
          </Panel>
        </div>
      </section>

      {/* Pipeline + deadlines */}
      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <Panel
          title="Active pipeline"
          actions={
            <Link
              href="/proposals"
              className="font-mono text-[10px] font-bold uppercase tracking-widest underline-offset-2 hover:underline"
            >
              View all
            </Link>
          }
          dense
        >
          <div className="divide-y-2 divide-ink">
            {activeProposals.map((p) => (
              <Link
                key={p.id}
                href={`/proposals/${p.id}/editor`}
                className="grid grid-cols-[100px_1fr_auto] items-center gap-4 p-4 transition-colors hover:bg-bone/60"
              >
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-ink/60">
                    {p.code}
                  </span>
                  <span
                    className={`border-2 border-ink px-2 py-1 text-center font-display text-xl font-bold tabular-nums leading-none ${
                      p.daysLeft < 5
                        ? "bg-blood text-paper"
                        : p.daysLeft < 14
                          ? "bg-hazard text-ink"
                          : "bg-paper text-ink"
                    }`}
                  >
                    {p.daysLeft}d
                  </span>
                  <span className="text-center font-mono text-[9px] uppercase tracking-widest text-ink/60">
                    Remaining
                  </span>
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill value={p.status} />
                    <span className="font-mono text-[10px] uppercase tracking-wider text-ink/60">
                      {p.solicitation}
                    </span>
                  </div>
                  <div className="mt-1 font-display text-lg font-bold leading-tight">
                    {p.title}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-ink/60">
                    {p.agency} · Due {p.dueAt}
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <BarMeter label="Progress" value={p.progress} color="ink" />
                    <BarMeter
                      label="Compliance"
                      value={p.compliancePct}
                      color={p.compliancePct >= 90 ? "signal" : p.compliancePct >= 70 ? "hazard" : "blood"}
                    />
                    <BarMeter
                      label="Pages"
                      value={p.pagesEstimated}
                      max={p.pagesLimit}
                      color={p.pagesEstimated > p.pagesLimit * 0.95 ? "blood" : "ink"}
                      right={`${p.pagesEstimated}/${p.pagesLimit}`}
                    />
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-ink/60">
                    AI drafted
                  </div>
                  <div className="font-display text-2xl font-bold tabular-nums leading-none">
                    {p.aiPct}%
                  </div>
                  <div className="brut-chip mt-2 bg-bone">{p.captureManager}</div>
                </div>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel title="Upcoming deadlines">
          <div className="mb-3 grid grid-cols-4 border-b-2 border-ink pb-1 font-mono text-[9px] uppercase tracking-wider text-ink/60">
            <span>Now</span>
            <span>+7d</span>
            <span>+15d</span>
            <span className="text-right">+30d</span>
          </div>

          <ul className="flex flex-col gap-2.5">
            {proposals
              .slice()
              .sort((a, b) => a.daysLeft - b.daysLeft)
              .map((p) => {
                const pct = Math.max(0, Math.min(100, (p.daysLeft / 30) * 100));
                return (
                  <li key={p.id} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider">
                      <span className="font-bold">{p.code}</span>
                      <span className="tabular-nums text-ink/60">{p.daysLeft}d</span>
                    </div>
                    <GanttRow
                      startPct={0}
                      endPct={pct}
                      marker={0}
                      label={p.title.slice(0, 26)}
                      color={
                        p.daysLeft < 5
                          ? "bg-blood"
                          : p.daysLeft < 15
                            ? "bg-hazard"
                            : "bg-ink"
                      }
                    />
                  </li>
                );
              })}
          </ul>

          <div className="mt-4 grid grid-cols-2 gap-2 font-mono text-[10px] uppercase">
            <div className="border-2 border-ink bg-paper p-2">
              <div className="text-ink/60">Critical (&lt;5d)</div>
              <div className="font-display text-xl font-bold leading-none text-blood">
                02
              </div>
            </div>
            <div className="border-2 border-ink bg-paper p-2">
              <div className="text-ink/60">Warning (&lt;15d)</div>
              <div className="font-display text-xl font-bold leading-none">01</div>
            </div>
          </div>
        </Panel>
      </section>

      {/* Heat + AI + SAM */}
      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1fr_1fr]">
        <Panel title="Agency × phase load">
          <HeatGrid
            title="Active proposals · 30 days"
            rows={["Navy", "Army", "GSA", "DOS", "HHS"]}
            cols={["Outl.", "Draft", "Pink", "Red", "Gold", "Final", "Prod"]}
            matrix={[
              [1, 3, 2, 1, 0, 0, 0],
              [2, 4, 1, 0, 0, 0, 0],
              [0, 1, 2, 3, 2, 1, 0],
              [1, 0, 0, 1, 0, 2, 0],
              [0, 1, 0, 0, 0, 0, 0],
            ]}
          />
          <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-[10px]">
            <SmallKPI k="Agencies" v="11" />
            <SmallKPI k="NAICS" v="04" />
            <SmallKPI k="Set-aside" v="03" />
          </div>
        </Panel>

        <Panel title="AI engine · 24 h">
          <div className="grid grid-cols-2 gap-2">
            <SmallKPI k="Drafts" v="38" />
            <SmallKPI k="Revisions" v="112" />
            <SmallKPI k="Embeddings" v="4.2k" />
            <SmallKPI k="Audit log" v="OK" />
          </div>

          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider">
              <span>Model mix</span>
              <span className="text-ink/60">Sonnet · Opus · Haiku</span>
            </div>
            <div className="flex h-5 w-full border-2 border-ink">
              <div className="bg-ink" style={{ width: "72%" }} />
              <div className="bg-hazard" style={{ width: "22%" }} />
              <div className="bg-bone" style={{ width: "6%" }} />
            </div>
            <div className="mt-1 font-mono text-[10px] text-ink/60">
              72% Sonnet · 22% Opus · 6% Haiku
            </div>
          </div>

          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider">
              <span>Tokens / hr</span>
              <span className="text-ink/60">Peak 94k</span>
            </div>
            <div className="h-16">
              <BarSpark
                data={[12, 19, 17, 24, 30, 28, 36, 42, 38, 44, 48, 54, 47, 61, 58, 63, 70, 66, 72, 78, 74, 82, 88, 94]}
                peak={23}
              />
            </div>
          </div>
        </Panel>

        <Panel
          title="SAM.gov — new hits"
          actions={
            <Link
              href="/solicitations"
              className="font-mono text-[10px] font-bold uppercase tracking-widest underline-offset-2 hover:underline"
            >
              Browse
            </Link>
          }
        >
          <ul className="flex flex-col gap-2">
            {solicitations.slice(0, 4).map((s) => (
              <li
                key={s.id}
                className="flex items-start justify-between gap-2 border-2 border-ink bg-paper p-2"
              >
                <div className="min-w-0">
                  <div className="font-mono text-[9px] uppercase tracking-widest text-ink/60">
                    {s.agency}
                  </div>
                  <div className="font-display text-sm font-bold leading-tight">
                    {s.title}
                  </div>
                  <div className="mt-0.5 font-mono text-[9px] uppercase tracking-widest text-ink/60">
                    {s.number} · NAICS {s.naics} · {s.setAside}
                  </div>
                  <div className="mt-1">
                    <DotMeter value={s.pWin} steps={14} filled="bg-ink" />
                  </div>
                </div>
                <StatusPill value={s.bidDecision} />
              </li>
            ))}
          </ul>
        </Panel>
      </section>

      {/* Critical comments + Executive summary */}
      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <Panel
          title="Critical review comments"
          actions={
            <Link
              href="/proposals/FRG-0042/review"
              className="font-mono text-[10px] font-bold uppercase tracking-widest underline-offset-2 hover:underline"
            >
              Open review
            </Link>
          }
        >
          <ul className="flex flex-col gap-3">
            {reviewComments
              .filter((c) => c.severity === "CRITICAL" || c.severity === "MAJOR")
              .slice(0, 5)
              .map((c) => (
                <li
                  key={c.id}
                  className="relative grid grid-cols-[90px_1fr_auto] gap-3 border-2 border-ink bg-paper p-3"
                >
                  <span
                    className={`absolute left-0 top-0 h-full w-1 ${
                      c.severity === "CRITICAL" ? "bg-blood" : "bg-hazard"
                    }`}
                    aria-hidden
                  />
                  <div className="pl-2">
                    <StatusPill value={c.severity} />
                    <div className="mt-1 font-mono text-[10px] uppercase text-ink/60">
                      {c.cycle} · {c.age}
                    </div>
                  </div>
                  <div>
                    <div className="font-display text-sm font-bold">{c.section}</div>
                    <p className="mt-0.5 text-sm leading-snug">{c.comment}</p>
                    <div className="mt-1 font-mono text-[10px] uppercase text-ink/60">
                      {c.reviewer} · Anchor {c.anchor}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="brut-chip bg-bone">{c.id}</span>
                    <button className="brut-btn-primary px-2 py-1 text-[10px]">
                      Open
                    </button>
                  </div>
                </li>
              ))}
          </ul>
        </Panel>

        <Panel title="Daily capture note">
          <div className="font-mono text-[11px] text-ink/60">
            Prepared by J. Calder · {new Date().toISOString().slice(0, 10)}
          </div>
          <ol className="mt-3 ml-5 list-decimal space-y-2 text-[13px] leading-relaxed">
            <li>
              <b>FRG-0042 §3.2.3 Governance</b> is not yet drafted. Assign today; required by
              Section M.3.1(a).
            </li>
            <li>
              Contract number mismatch on Past Performance #2 —{" "}
              <span className="bg-hazard px-0.5">verify against CPARS</span> before submission.
            </li>
            <li>
              Table 3-1 font is 9 pt; Section L.6.1 requires ≥ 10 pt —{" "}
              <span className="font-bold text-blood">fails format gate</span>.
            </li>
            <li>
              Red Team readiness at 78%. Proceed if FRG-0039 stays green by end of day.
            </li>
          </ol>
          <div className="mt-4 border-t-2 border-ink pt-3 font-mono text-[10px] uppercase tracking-widest text-ink/60">
            J. Calder · Capture Manager
          </div>
        </Panel>
      </section>
    </>
  );
}

function KeyFact({
  label,
  value,
  sub,
  emphasize,
}: {
  label: string;
  value: string;
  sub?: string;
  emphasize?: "blood" | "hazard" | "signal";
}) {
  const valueTone =
    emphasize === "blood"
      ? "text-blood"
      : emphasize === "hazard"
        ? "text-ink"
        : emphasize === "signal"
          ? "text-ink"
          : "text-ink";
  return (
    <div className="border-2 border-ink bg-paper px-3 py-2">
      <div className="font-mono text-[10px] uppercase tracking-widest text-ink/60">
        {label}
      </div>
      <div
        className={`font-display text-3xl font-bold tabular-nums leading-none ${valueTone}`}
      >
        {value}
      </div>
      {sub ? (
        <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-ink/60">
          {sub}
        </div>
      ) : null}
    </div>
  );
}

function AxisRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 text-ink/70">{label}</span>
      <div className="relative h-2 flex-1 border-2 border-ink bg-paper">
        <div className="h-full bg-ink" style={{ width: `${value}%` }} />
      </div>
      <span className="w-8 text-right font-bold tabular-nums">{value}</span>
    </div>
  );
}

function SmallKPI({ k, v }: { k: string; v: string }) {
  return (
    <div className="border-2 border-ink bg-paper p-2">
      <div className="font-mono text-[9px] uppercase tracking-widest text-ink/60">{k}</div>
      <div className="font-display text-lg font-bold tabular-nums leading-none">{v}</div>
    </div>
  );
}
