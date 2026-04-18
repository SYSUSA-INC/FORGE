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
        eyebrow="Command — Overview"
        title="COMMAND"
        subtitle="Capture operations, proposal velocity, compliance deltas, and AI generation across the active pipeline."
        actions={
          <>
            <button className="brut-btn">Refresh</button>
            <Link href="/solicitations/new" className="brut-btn-hazard">
              + New solicitation
            </Link>
            <Link href="/proposals/new" className="brut-btn-primary">
              + New proposal
            </Link>
          </>
        }
        meta={[
          { label: "Active proposals", value: "04", accent: "hazard" },
          { label: "In review", value: "02" },
          { label: "Pipeline value", value: "$185M", accent: "signal" },
          { label: "Next deadline", value: "2d · 4h", accent: "blood" },
        ]}
      />

      {/* HERO ROW — Priority proposal + capture readiness + win probability */}
      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_1fr_1fr]">
        {/* Priority proposal */}
        <div className="border-2 border-ink bg-paper shadow-brut">
          <header className="flex items-center justify-between border-b-2 border-ink bg-ink px-4 py-2 text-paper">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em]">
              Highest priority · {hottest?.code}
            </span>
            <StatusPill value={hottest?.status ?? ""} />
          </header>

          <div className="p-5">
            <div className="font-display text-2xl font-bold leading-tight">
              {hottest?.title}
            </div>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-wider text-ink/60">
              {hottest?.solicitation} · {hottest?.agency}
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="border-2 border-ink bg-paper p-3 text-center">
                <div className="font-mono text-[10px] uppercase tracking-widest text-ink/60">
                  Due in
                </div>
                <div className="font-display text-4xl font-bold leading-none">
                  {hottest?.daysLeft}d
                </div>
              </div>
              <div className="border-2 border-ink bg-paper p-3 text-center">
                <div className="font-mono text-[10px] uppercase tracking-widest text-ink/60">
                  Compliance
                </div>
                <div className="font-display text-4xl font-bold leading-none">
                  {hottest?.compliancePct}%
                </div>
              </div>
              <div className="border-2 border-ink bg-paper p-3 text-center">
                <div className="font-mono text-[10px] uppercase tracking-widest text-ink/60">
                  Pages
                </div>
                <div className="font-display text-4xl font-bold leading-none">
                  {hottest?.pagesEstimated}/{hottest?.pagesLimit}
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <Link
                href={`/proposals/${hottest?.id}/editor`}
                className="brut-btn-primary w-full"
              >
                Open editor
              </Link>
              <Link
                href={`/proposals/${hottest?.id}/compliance`}
                className="brut-btn w-full"
              >
                View compliance
              </Link>
            </div>
          </div>
        </div>

        {/* Capture readiness radar */}
        <Panel title="Capture readiness" code="CR-01">
          <div className="grid grid-cols-[1fr_120px] items-center gap-3">
            <div className="h-[240px]">
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
            <div className="flex flex-col gap-2 font-mono text-[11px]">
              <ReadItem k="P(win)" v="54%" />
              <ReadItem k="Δ WoW" v="+6.2" tone="signal" />
              <ReadItem k="Model" v="GBM-24" />
              <ReadItem k="Outlook" v="Positive" tone="signal" />
            </div>
          </div>
        </Panel>

        {/* Win probability trend */}
        <Panel title="Win probability · 90d" code="PW-01">
          <div className="flex items-end justify-between">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/60">
                Weighted avg
              </div>
              <div className="font-display text-6xl font-bold leading-none">54%</div>
            </div>
            <div className="text-right">
              <div className="font-mono text-[10px] uppercase tracking-widest text-ink/60">
                Best · FRG-0039
              </div>
              <div className="font-display text-3xl font-bold leading-none">91%</div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-ink/60">
                GSA Data Platform
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
            <span>Wk 1</span>
            <span>Wk 6</span>
            <span>Wk 12</span>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-1">
            {proposals.map((p) => (
              <div key={p.id} className="border-2 border-ink bg-paper p-2">
                <div className="font-mono text-[9px] uppercase text-ink/60">
                  {p.code.replace("FRG-", "")}
                </div>
                <div className="font-display text-xl font-bold leading-none">
                  {p.compliancePct}%
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      {/* Pipeline + deadline stack */}
      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <Panel
          title="Active pipeline"
          code="OPS-01"
          accent="ink"
          actions={
            <span className="brut-pill bg-paper text-ink">
              {activeProposals.length} open
            </span>
          }
          dense
        >
          <div className="divide-y-2 divide-ink">
            {activeProposals.map((p) => (
              <Link
                key={p.id}
                href={`/proposals/${p.id}/editor`}
                className="grid grid-cols-[110px_1fr_auto] items-center gap-4 p-4 transition-colors hover:bg-bone"
              >
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase text-ink/60">
                    {p.code}
                  </span>
                  <span
                    className={`border-2 border-ink px-2 py-1 text-center font-display text-2xl font-bold leading-none ${
                      p.daysLeft < 5
                        ? "bg-blood text-paper"
                        : p.daysLeft < 14
                          ? "bg-hazard"
                          : "bg-paper"
                    }`}
                  >
                    {p.daysLeft}d
                  </span>
                  <span className="text-center font-mono text-[9px] uppercase tracking-widest text-ink/60">
                    remaining
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
                    {p.agency} · Due {p.dueAt}
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <BarMeter label="Progress" value={p.progress} color="ink" />
                    <BarMeter label="Compliance" value={p.compliancePct} color="signal" />
                    <BarMeter
                      label="Pages"
                      value={p.pagesEstimated}
                      max={p.pagesLimit}
                      color={p.pagesEstimated > p.pagesLimit * 0.95 ? "blood" : "hazard"}
                      right={`${p.pagesEstimated}/${p.pagesLimit}p`}
                    />
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-ink/60">
                    AI generated
                  </div>
                  <div className="font-display text-3xl font-bold leading-none">
                    {p.aiPct}%
                  </div>
                  <div className="brut-chip mt-2 bg-bone">{p.captureManager}</div>
                </div>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel title="Upcoming deadlines" code="OPS-02">
          <div className="mb-3 grid grid-cols-4 items-end border-b-2 border-ink pb-1 font-mono text-[9px] uppercase tracking-widest text-ink/60">
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
                      <span className="text-ink/60">{p.daysLeft}d</span>
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
              <div className="font-display text-2xl font-bold leading-none text-blood">02</div>
            </div>
            <div className="border-2 border-ink bg-paper p-2">
              <div className="text-ink/60">Warning (&lt;15d)</div>
              <div className="font-display text-2xl font-bold leading-none">01</div>
            </div>
          </div>
        </Panel>
      </section>

      {/* Heat + AI + SAM */}
      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1fr_1fr]">
        <Panel title="Agency × phase load" code="HX-01">
          <HeatGrid
            title="Active proposals · 30d"
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
          <div className="mt-3 grid grid-cols-3 gap-2 font-mono text-[10px] uppercase">
            <div className="border-2 border-ink bg-paper p-2">
              <div className="text-ink/60">Agencies</div>
              <div className="font-display text-xl font-bold leading-none">11</div>
            </div>
            <div className="border-2 border-ink bg-paper p-2">
              <div className="text-ink/60">NAICS</div>
              <div className="font-display text-xl font-bold leading-none">04</div>
            </div>
            <div className="border-2 border-ink bg-paper p-2">
              <div className="text-ink/60">Set-aside</div>
              <div className="font-display text-xl font-bold leading-none">03</div>
            </div>
          </div>
        </Panel>

        <Panel title="AI engine · 24h" code="AI-01">
          <div className="mb-3 grid grid-cols-2 gap-2">
            <Mini label="Drafts" value="38" />
            <Mini label="Revisions" value="112" />
            <Mini label="Embeddings" value="4.2k" />
            <Mini label="Audit log" value="OK" />
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider">
              <span>Model mix</span>
              <span className="text-ink/60">Sonnet · Opus · Haiku</span>
            </div>
            <div className="flex h-6 w-full border-2 border-ink">
              <div className="bg-ink" style={{ width: "72%" }} />
              <div className="bg-hazard" style={{ width: "22%" }} />
              <div className="bg-bone" style={{ width: "6%" }} />
            </div>
            <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-ink/60">
              72% Sonnet · 22% Opus · 6% Haiku
            </div>
          </div>

          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider">
              <span>Tokens / hr</span>
              <span className="text-ink/60">Peak 94k</span>
            </div>
            <div className="h-20">
              <BarSpark
                data={[12, 19, 17, 24, 30, 28, 36, 42, 38, 44, 48, 54, 47, 61, 58, 63, 70, 66, 72, 78, 74, 82, 88, 94]}
                peak={23}
              />
            </div>
          </div>
        </Panel>

        <Panel title="SAM.gov — new hits" code="INT-01">
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
                    <DotMeter value={s.pWin} steps={14} filled="bg-hazard" />
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
        <Panel title="Critical review comments" code="QA-01">
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
                    <button className="brut-btn-primary px-2 py-1 text-[10px]">Open</button>
                  </div>
                </li>
              ))}
          </ul>
        </Panel>

        <Panel title="Executive summary" code="EX-01">
          <div className="font-mono text-[11px] text-ink/70">
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
              Table 3-1 font is 9pt; Section L.6.1 requires ≥10pt —{" "}
              <span className="font-bold text-blood">fails format gate</span>.
            </li>
            <li>
              Red Team readiness at 78%. Proceed if FRG-0039 stays green by end of day.
            </li>
          </ol>
          <div className="mt-4 border-t-2 border-ink pt-3 font-mono text-[10px] uppercase tracking-widest text-ink/60">
            Signed · J. Calder, Capture Manager
          </div>
        </Panel>
      </section>
    </>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-2 border-ink bg-paper p-2">
      <div className="font-mono text-[9px] uppercase tracking-widest text-ink/60">
        {label}
      </div>
      <div className="font-display text-xl font-bold leading-none">{value}</div>
    </div>
  );
}

function ReadItem({
  k,
  v,
  tone,
}: {
  k: string;
  v: string;
  tone?: "signal" | "hazard" | "blood";
}) {
  const bg =
    tone === "signal"
      ? "bg-signal"
      : tone === "hazard"
        ? "bg-hazard"
        : tone === "blood"
          ? "bg-blood text-paper"
          : "bg-paper";
  return (
    <div className={`flex items-center justify-between border-2 border-ink ${bg} px-2 py-1`}>
      <span className="text-[10px] uppercase tracking-widest text-ink/70">{k}</span>
      <span className="font-bold">{v}</span>
    </div>
  );
}
