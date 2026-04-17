import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatTile } from "@/components/ui/StatTile";
import { StatusPill } from "@/components/ui/StatusPill";
import { BarMeter } from "@/components/ui/BarMeter";
import { proposals, solicitations, reviewComments } from "@/lib/mock";

export default function DashboardPage() {
  const activeProposals = proposals.filter((p) => p.status !== "SUBMITTED");

  return (
    <>
      <PageHeader
        eyebrow="CMD // COMMAND CONSOLE · T-MINUS TRACKER"
        title="COMMAND"
        subtitle="Capture ops, proposal velocity, compliance deltas, and AI generation across the active pipeline."
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

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="P(WIN) · WEIGHTED"
          value="54%"
          delta={{ value: "+6.2 WoW", up: true }}
          accent="hazard"
          hint="Model · GBM-24"
        />
        <StatTile
          label="COMPLIANCE · AVG"
          value="76%"
          delta={{ value: "+4.1 WoW", up: true }}
          accent="signal"
          hint="Across 4 proposals"
        />
        <StatTile
          label="AI GEN · 30D"
          value="1.24M"
          delta={{ value: "tokens · -12%", up: false }}
          accent="ink"
          hint="Sonnet 4.6"
        />
        <StatTile
          label="OPEN CRITICALS"
          value="07"
          delta={{ value: "Pink · FRG-0042" }}
          accent="blood"
          hint="Review cycles"
        />
      </section>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <Panel
          title="ACTIVE PIPELINE"
          code="OPS-01"
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
                className="grid grid-cols-[96px_1fr_auto] items-center gap-4 p-4 transition-colors hover:bg-bone"
              >
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-[10px] uppercase text-ink/60">{p.code}</span>
                  <span className="border-2 border-ink bg-ink px-1.5 py-0.5 text-center font-display text-base font-bold text-paper">
                    T-{String(p.daysLeft).padStart(2, "0")}D
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
                  <div className="font-display text-3xl font-bold">{p.aiPct}%</div>
                  <div className="brut-chip mt-1 bg-bone">{p.captureManager}</div>
                </div>
              </Link>
            ))}
          </div>
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title="DEADLINE STACK" code="OPS-02" accent="blood">
            <ul className="flex flex-col gap-3">
              {proposals
                .slice()
                .sort((a, b) => a.daysLeft - b.daysLeft)
                .map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 border-l-4 border-ink pl-3">
                    <div>
                      <div className="font-mono text-[10px] uppercase text-ink/60">{p.code}</div>
                      <div className="font-display text-sm font-bold">{p.title}</div>
                      <div className="font-mono text-[10px] uppercase text-ink/60">
                        DUE {p.dueAt}
                      </div>
                    </div>
                    <div className="brut-card-sm bg-hazard px-2 py-1 text-center">
                      <div className="font-mono text-[9px] uppercase">T-MINUS</div>
                      <div className="font-display text-2xl font-bold leading-none">
                        {String(p.daysLeft).padStart(2, "0")}D
                      </div>
                    </div>
                  </li>
                ))}
            </ul>
          </Panel>

          <Panel title="SAM.GOV · FRESH HITS" code="INT-03" accent="cobalt">
            <ul className="flex flex-col gap-2 font-mono text-xs">
              {solicitations.slice(0, 4).map((s) => (
                <li
                  key={s.id}
                  className="flex items-start justify-between gap-2 border-b border-ink/20 pb-2 last:border-0"
                >
                  <div>
                    <div className="text-[10px] uppercase text-ink/60">{s.agency}</div>
                    <div className="font-display text-sm font-bold leading-tight">
                      {s.title}
                    </div>
                    <div className="mt-0.5 text-[10px] uppercase text-ink/60">
                      {s.number} · NAICS {s.naics} · {s.setAside}
                    </div>
                  </div>
                  <StatusPill value={s.bidDecision} />
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="RED LINE · CRITICAL COMMENTS" code="QA-04" accent="blood" className="xl:col-span-2">
          <ul className="flex flex-col gap-3">
            {reviewComments
              .filter((c) => c.severity === "CRITICAL" || c.severity === "MAJOR")
              .slice(0, 5)
              .map((c) => (
                <li
                  key={c.id}
                  className="grid grid-cols-[80px_1fr_auto] gap-3 border-2 border-ink bg-paper p-3"
                >
                  <div>
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
                </li>
              ))}
          </ul>
        </Panel>

        <Panel title="AI ENGINE · 24H" code="AI-05" accent="signal">
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2">
              <Mini label="DRAFTS" value="38" />
              <Mini label="REVISIONS" value="112" />
              <Mini label="EMBEDDINGS" value="4.2K" />
              <Mini label="AUDIT LOG" value="OK" signal />
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider">
                <span>MODEL MIX</span>
                <span className="text-ink/60">SONNET · OPUS</span>
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
            <Sparkline />
          </div>
        </Panel>
      </div>
    </>
  );
}

function Mini({ label, value, signal }: { label: string; value: string; signal?: boolean }) {
  return (
    <div className={`border-2 border-ink p-2 ${signal ? "bg-signal" : "bg-paper"}`}>
      <div className="font-mono text-[9px] uppercase tracking-widest text-ink/60">{label}</div>
      <div className="font-display text-xl font-bold leading-none">{value}</div>
    </div>
  );
}

function Sparkline() {
  const bars = [12, 19, 17, 24, 30, 28, 36, 42, 38, 44, 48, 54, 47, 61, 58, 63, 70, 66, 72, 78, 74, 82, 88, 94];
  const max = Math.max(...bars);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider">
        <span>TOKENS / HR</span>
        <span className="text-ink/60">PEAK 94K</span>
      </div>
      <div className="flex h-20 items-end gap-[2px] border-2 border-ink bg-paper p-1">
        {bars.map((b, i) => (
          <div
            key={i}
            className="flex-1 bg-ink"
            style={{ height: `${(b / max) * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}
