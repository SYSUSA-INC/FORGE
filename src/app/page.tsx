import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusPill } from "@/components/ui/StatusPill";
import { BarMeter } from "@/components/ui/BarMeter";
import { TMinus } from "@/components/ui/TMinus";
import { Radar } from "@/components/ui/Radar";
import { HeatGrid } from "@/components/ui/HeatGrid";
import { Sparkline, BarSpark } from "@/components/ui/Sparkline";
import { GanttRow } from "@/components/ui/GanttRow";
import { DotMeter } from "@/components/ui/DotMeter";
import { Stamp } from "@/components/ui/Stamp";
import { Perforation } from "@/components/ui/Perforation";
import { proposals, solicitations, reviewComments } from "@/lib/mock";

export default function DashboardPage() {
  const activeProposals = proposals.filter((p) => p.status !== "SUBMITTED");
  const hottest = [...activeProposals].sort((a, b) => a.daysLeft - b.daysLeft)[0];

  return (
    <>
      <PageHeader
        eyebrow="CMD // COMMAND CONSOLE · T-MINUS TRACKER"
        title="COMMAND"
        subtitle="Capture ops, proposal velocity, compliance deltas, and AI generation across the active pipeline."
        barcode="FORGE-CMD-0042"
        stamp={{ label: "OPS ACTIVE // CUI", tone: "blood" }}
        actions={
          <>
            <button className="brut-btn">REFRESH · ⌘R</button>
            <Link href="/solicitations/new" className="brut-btn-hazard">
              + NEW SOLICITATION
            </Link>
            <Link href="/proposals/new" className="brut-btn-primary">
              + NEW PROPOSAL
            </Link>
          </>
        }
        meta={[
          { label: "ACTIVE PROPOSALS", value: "04", accent: "hazard" },
          { label: "IN REVIEW", value: "02" },
          { label: "BID VALUE · TTL", value: "$185M", accent: "signal" },
          { label: "NEXT DEADLINE", value: "02D · 04H", accent: "blood" },
        ]}
      />

      {/* HERO ROW — asymmetric: T-MINUS + CAPTURE RADAR + WIN PROBABILITY */}
      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_1fr_1fr]">
        {/* T-Minus hero block */}
        <div className="relative border-2 border-ink bg-ink p-5 text-paper shadow-brut-xl">
          <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.3em] text-paper/70">
            <span>▸ HOT PROPOSAL · {hottest?.code}</span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 animate-blink bg-hazard" />
              WAR ROOM
            </span>
          </div>

          <div className="font-display text-lg font-bold uppercase leading-tight tracking-tight text-paper">
            {hottest?.title}
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-paper/60">
            {hottest?.solicitation} · {hottest?.agency}
          </div>

          <div className="mt-4">
            <TMinus days={hottest?.daysLeft ?? 0} hours={7} minutes={42} label="UNTIL DUE" intensity="hazard" />
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <Tile k="PROGRESS" v={`${hottest?.progress}%`} accent="signal" />
            <Tile k="COMPLIANCE" v={`${hottest?.compliancePct}%`} accent="hazard" />
            <Tile k="PAGES" v={`${hottest?.pagesEstimated}/${hottest?.pagesLimit}`} accent="blood" />
          </div>

          <Link
            href={`/proposals/${hottest?.id}/editor`}
            className="brut-btn-hazard mt-4 w-full justify-between"
          >
            <span>ENTER WAR ROOM</span>
            <span>→</span>
          </Link>

          <div
            className="pointer-events-none absolute -right-4 -top-3"
            style={{ transform: "rotate(6deg)" }}
          >
            <Stamp label="RED LINE" tone="blood" angle={0} />
          </div>
        </div>

        {/* Capture readiness radar */}
        <div className="relative border-2 border-ink bg-paper shadow-brut-xl">
          <header className="flex items-center justify-between border-b-2 border-ink bg-hazard px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em]">
            <span>[CAP-RDY] CAPTURE READINESS</span>
            <span className="opacity-70">RADAR · 7 AXIS</span>
          </header>
          <div className="grid grid-cols-[1fr_140px] items-center gap-3 p-3">
            <div className="h-[240px]">
              <Radar
                data={[
                  { label: "STRAT FIT", value: 82 },
                  { label: "TECH", value: 68 },
                  { label: "PP", value: 74 },
                  { label: "PRICE", value: 54 },
                  { label: "STAFF", value: 71 },
                  { label: "SECURITY", value: 88 },
                  { label: "PAST WIN", value: 61 },
                ]}
              />
            </div>
            <div className="flex flex-col gap-1.5 font-mono text-[10px] uppercase tracking-widest">
              <ReadItem k="P(WIN)" v="54%" tone="hazard" />
              <ReadItem k="Δ WoW" v="+6.2" tone="signal" />
              <ReadItem k="MODEL" v="GBM-24" />
              <ReadItem k="OUTLOOK" v="BULLISH" tone="signal" />
              <div className="brut-diagonal-hazard mt-1 h-3 border-2 border-ink" />
            </div>
          </div>
        </div>

        {/* Win Probability stacked */}
        <div className="relative border-2 border-ink bg-paper shadow-brut-xl">
          <header className="flex items-center justify-between border-b-2 border-ink bg-ink px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-paper">
            <span>[PWIN-24] WIN PROBABILITY · 90D</span>
            <span className="opacity-70">N=12 BIDS</span>
          </header>
          <div className="p-4">
            <div className="flex items-end justify-between">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-[0.25em] text-ink/60">
                  WEIGHTED AVG
                </div>
                <div className="brut-stencil text-7xl leading-none text-ink">54</div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-ink/60">%</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[10px] uppercase tracking-widest text-ink/60">
                  BEST · FRG-0039
                </div>
                <div className="font-display text-4xl font-bold leading-none">91%</div>
                <div className="font-mono text-[10px] uppercase tracking-widest text-ink/60">
                  GSA DATA PLATFORM
                </div>
              </div>
            </div>

            <div className="my-3 border-t-2 border-ink" />

            <div className="h-20">
              <Sparkline
                data={[32, 38, 34, 41, 40, 47, 52, 49, 55, 51, 58, 54]}
                color="#0A0A0A"
                fill="#FFD500"
              />
            </div>
            <div className="mt-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-ink/60">
              <span>W1</span>
              <span>W6</span>
              <span>W12</span>
            </div>

            <div className="mt-3 grid grid-cols-4 gap-1">
              {proposals.map((p) => (
                <div key={p.id} className="border-2 border-ink bg-paper p-1.5">
                  <div className="font-mono text-[9px] uppercase text-ink/60">{p.code.replace("FRG-", "")}</div>
                  <div className="brut-stencil text-xl leading-none">
                    {p.compliancePct}
                  </div>
                  <div className="font-mono text-[9px] uppercase text-ink/60">%</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* PIPELINE + DEADLINE GANTT */}
      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <Panel
          title="ACTIVE PIPELINE"
          code="OPS-01"
          accent="ink"
          actions={
            <span className="brut-pill bg-paper text-ink">{activeProposals.length} OPEN</span>
          }
          dense
        >
          <div className="divide-y-2 divide-ink">
            {activeProposals.map((p) => (
              <Link
                key={p.id}
                href={`/proposals/${p.id}/editor`}
                className="group relative grid grid-cols-[110px_1fr_auto] items-center gap-4 p-4 transition-colors hover:bg-hazard/20"
              >
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase text-ink/60">{p.code}</span>
                  <span
                    className={`brut-stencil border-2 border-ink px-2 py-1 text-center text-3xl leading-none ${
                      p.daysLeft < 5 ? "bg-blood text-paper" : p.daysLeft < 14 ? "bg-hazard" : "bg-ink text-paper"
                    }`}
                  >
                    T-{String(p.daysLeft).padStart(2, "0")}
                  </span>
                  <span className="text-center font-mono text-[9px] uppercase tracking-widest text-ink/60">
                    DAYS
                  </span>
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill value={p.status} />
                    <span className="font-mono text-[10px] uppercase tracking-wider text-ink/60">
                      {p.solicitation}
                    </span>
                  </div>
                  <div className="mt-1 font-display text-xl font-bold leading-tight">
                    {p.title}
                  </div>
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-ink/60">
                    {p.agency} · DUE {p.dueAt}
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <BarMeter label="PROGRESS" value={p.progress} color="ink" />
                    <BarMeter label="COMPLIANCE" value={p.compliancePct} color="signal" />
                    <BarMeter
                      label="PAGES"
                      value={p.pagesEstimated}
                      max={p.pagesLimit}
                      color={p.pagesEstimated > p.pagesLimit * 0.95 ? "blood" : "hazard"}
                      right={`${p.pagesEstimated}/${p.pagesLimit}p`}
                    />
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-ink/60">
                    AI GEN
                  </div>
                  <div className="brut-stencil text-4xl leading-none">{p.aiPct}</div>
                  <div className="font-mono text-[10px] uppercase tracking-widest text-ink/60">%</div>
                  <div className="brut-chip mt-2 bg-bone">{p.captureManager}</div>
                </div>
              </Link>
            ))}
          </div>
        </Panel>

        {/* Gantt-style deadline stack */}
        <Panel title="DEADLINE STACK · 30D" code="OPS-02" accent="blood">
          <div className="mb-3 grid grid-cols-4 items-end border-b-2 border-ink pb-1 font-mono text-[9px] uppercase tracking-widest text-ink/60">
            <span>NOW</span>
            <span>+7D</span>
            <span>+15D</span>
            <span className="text-right">+30D</span>
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
                      <span className="text-ink/60">T-{p.daysLeft}D</span>
                    </div>
                    <GanttRow
                      startPct={0}
                      endPct={pct}
                      marker={0}
                      label={p.title.slice(0, 26).toUpperCase()}
                      color={p.daysLeft < 5 ? "bg-blood" : p.daysLeft < 15 ? "bg-hazard" : "bg-ink"}
                    />
                  </li>
                );
              })}
          </ul>

          <Perforation className="mt-4" />

          <div className="mt-4 grid grid-cols-2 gap-2 font-mono text-[10px]">
            <div className="border-2 border-ink bg-blood p-2 text-paper">
              <div className="opacity-80">CRITICAL (&lt;5D)</div>
              <div className="brut-stencil text-3xl leading-none">02</div>
            </div>
            <div className="border-2 border-ink bg-hazard p-2">
              <div className="opacity-70">WARNING (&lt;15D)</div>
              <div className="brut-stencil text-3xl leading-none">01</div>
            </div>
          </div>
        </Panel>
      </section>

      {/* HEAT GRID + AI ENGINE + SAM HITS */}
      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1fr_1fr]">
        <Panel title="AGENCY × PHASE HEAT" code="HX-07" accent="plum">
          <HeatGrid
            title="ACTIVE LOAD · 30D"
            legend="BIDS IN MOTION"
            rows={["NAVY", "ARMY", "GSA", "DOS", "HHS"]}
            cols={["OUTLN", "DRAFT", "PINK", "RED", "GOLD", "FINAL", "PROD"]}
            matrix={[
              [1, 3, 2, 1, 0, 0, 0],
              [2, 4, 1, 0, 0, 0, 0],
              [0, 1, 2, 3, 2, 1, 0],
              [1, 0, 0, 1, 0, 2, 0],
              [0, 1, 0, 0, 0, 0, 0],
            ]}
          />
          <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-[10px] uppercase">
            <div className="border-2 border-ink bg-paper p-2">
              <div className="text-ink/60">AGENCIES</div>
              <div className="brut-stencil text-2xl leading-none">11</div>
            </div>
            <div className="border-2 border-ink bg-hazard p-2">
              <div className="text-ink/70">NAICS</div>
              <div className="brut-stencil text-2xl leading-none">04</div>
            </div>
            <div className="border-2 border-ink bg-signal p-2">
              <div className="text-ink/70">SET-ASIDE</div>
              <div className="brut-stencil text-2xl leading-none">03</div>
            </div>
          </div>
        </Panel>

        <Panel title="AI ENGINE · 24H" code="AI-05" accent="signal">
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Mini label="DRAFTS" value="38" />
            <Mini label="REVISIONS" value="112" />
            <Mini label="EMBEDDINGS" value="4.2K" />
            <Mini label="AUDIT LOG" value="OK" signal />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider">
              <span>MODEL MIX</span>
              <span className="text-ink/60">SONNET · OPUS · HAIKU</span>
            </div>
            <div className="flex h-6 w-full border-2 border-ink">
              <div className="bg-ink" style={{ width: "72%" }} />
              <div className="bg-hazard" style={{ width: "22%" }} />
              <div className="bg-blood" style={{ width: "6%" }} />
            </div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-ink/60">
              72% SONNET · 22% OPUS · 6% HAIKU
            </div>
          </div>

          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider">
              <span>TOKENS / HR</span>
              <span className="text-ink/60">PEAK 94K</span>
            </div>
            <div className="h-20">
              <BarSpark
                data={[12, 19, 17, 24, 30, 28, 36, 42, 38, 44, 48, 54, 47, 61, 58, 63, 70, 66, 72, 78, 74, 82, 88, 94]}
                peak={23}
              />
            </div>
          </div>

          <div className="mt-3 border-2 border-ink bg-ink p-2 font-mono text-[10px] uppercase text-paper">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 animate-blink bg-signal" /> STREAM · AO-3.2 DRAFT · 1,842 tok · 2.1s
            </div>
          </div>
        </Panel>

        <Panel title="SAM.GOV · FRESH HITS" code="INT-03" accent="cobalt">
          <ul className="flex flex-col gap-2">
            {solicitations.slice(0, 4).map((s) => (
              <li
                key={s.id}
                className="group relative flex items-start justify-between gap-2 border-2 border-ink bg-paper p-2 transition-all hover:-translate-y-0.5 hover:shadow-brut-sm"
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
                    <DotMeter value={s.pWin} steps={14} filled="bg-hazard" />
                  </div>
                </div>
                <StatusPill value={s.bidDecision} />
              </li>
            ))}
          </ul>
        </Panel>
      </section>

      {/* RED LINE / CLASSIFIED MEMO */}
      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <Panel title="RED LINE · CRITICAL COMMENTS" code="QA-04" accent="blood">
          <ul className="flex flex-col gap-3">
            {reviewComments
              .filter((c) => c.severity === "CRITICAL" || c.severity === "MAJOR")
              .slice(0, 5)
              .map((c, i) => (
                <li
                  key={c.id}
                  className="relative grid grid-cols-[90px_1fr_auto] gap-3 border-2 border-ink bg-paper p-3"
                >
                  {/* ticker stripe */}
                  <span className="absolute left-0 top-0 h-full w-1.5 bg-blood" />
                  <div className="pl-2">
                    <StatusPill value={c.severity} />
                    <div className="mt-1 font-mono text-[10px] uppercase text-ink/60">
                      {c.cycle} · {c.age}
                    </div>
                  </div>
                  <div>
                    <div className="font-display text-sm font-bold uppercase">
                      {c.section}
                    </div>
                    <p className="mt-0.5 text-sm leading-snug">{c.comment}</p>
                    <div className="mt-1 font-mono text-[10px] uppercase text-ink/60">
                      {c.reviewer} · Anchor {c.anchor}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="brut-chip bg-bone">{c.id}</span>
                    <button className="brut-btn-primary px-2 py-1 text-[10px]">OPEN</button>
                  </div>
                  {i === 0 ? (
                    <span
                      className="absolute -right-3 -top-3 border-[3px] border-blood bg-paper px-2 py-0.5 font-display text-[10px] font-black uppercase tracking-widest text-blood"
                      style={{ transform: "rotate(6deg)" }}
                    >
                      ▲ PRIORITY 01
                    </span>
                  ) : null}
                </li>
              ))}
          </ul>
        </Panel>

        {/* Classified-style CAPTURE MEMO */}
        <section className="relative overflow-hidden border-2 border-ink bg-bone shadow-brut-xl">
          <div className="flex items-center justify-between border-b-2 border-ink bg-blood px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-paper">
            <span>[MEMO-09] CAPTURE MEMO</span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 animate-blink bg-paper" />
              LIVE
            </span>
          </div>

          <div className="p-4 font-mono text-[11px]">
            <div className="mb-2 flex items-center justify-between uppercase tracking-widest text-ink/60">
              <span>FROM: J. CALDER / CAPTURE</span>
              <span>{new Date().toISOString().slice(0, 10)}</span>
            </div>

            <div className="brut-diagonal-blood mb-2 h-1.5" />

            <ol className="ml-5 list-decimal space-y-1.5 text-[12px] leading-relaxed">
              <li>
                <b>FRG-0042</b> Section 3.2.3 governance <span className="brut-redact">███████</span> — not drafted. Assign
                today.
              </li>
              <li>
                Contract# mismatch on Past Performance #2 — flag <span className="bg-hazard px-0.5">CPARS cross-check</span>.
              </li>
              <li>
                Table 3-1 font is 9pt, L.6.1 requires ≥10pt — <span className="bg-blood px-0.5 text-paper">FAIL</span>.
              </li>
              <li>
                Red Team readiness @ 78% — proceed if FRG-0039 stays green by EOD.
              </li>
            </ol>

            <div className="mt-4 flex items-center justify-between border-t-2 border-ink pt-2 text-[10px] uppercase text-ink/60">
              <span>CLASS · CUI // BID SENSITIVE</span>
              <span className="font-bold text-ink">SIGNED · J.C.</span>
            </div>
          </div>

          {/* stamp */}
          <span
            className="absolute right-4 top-24 border-[3px] border-blood px-2 py-1 font-display text-[11px] font-black uppercase tracking-[0.22em] text-blood opacity-85"
            style={{ transform: "rotate(-8deg)" }}
          >
            ✦ EYES ONLY ✦
          </span>
        </section>
      </section>
    </>
  );
}

function Tile({ k, v, accent }: { k: string; v: string; accent?: "signal" | "hazard" | "blood" | "ink" }) {
  const tone =
    accent === "signal"
      ? "bg-signal text-ink"
      : accent === "blood"
        ? "bg-blood text-paper"
        : accent === "hazard"
          ? "bg-hazard text-ink"
          : "bg-paper text-ink";
  return (
    <div className={`border-2 border-ink ${tone} p-2`}>
      <div className="font-mono text-[9px] uppercase tracking-widest opacity-80">{k}</div>
      <div className="brut-stencil text-xl leading-none">{v}</div>
    </div>
  );
}

function Mini({ label, value, signal }: { label: string; value: string; signal?: boolean }) {
  return (
    <div className={`border-2 border-ink p-2 ${signal ? "bg-signal" : "bg-paper"}`}>
      <div className="font-mono text-[9px] uppercase tracking-widest text-ink/60">{label}</div>
      <div className="brut-stencil text-2xl leading-none">{value}</div>
    </div>
  );
}

function ReadItem({ k, v, tone }: { k: string; v: string; tone?: "hazard" | "signal" | "blood" }) {
  const bg =
    tone === "hazard"
      ? "bg-hazard"
      : tone === "signal"
        ? "bg-signal"
        : tone === "blood"
          ? "bg-blood text-paper"
          : "bg-paper";
  return (
    <div className={`flex items-center justify-between border-2 border-ink ${bg} px-2 py-1`}>
      <span className="text-[9px] text-ink/70">{k}</span>
      <span className="font-bold">{v}</span>
    </div>
  );
}
