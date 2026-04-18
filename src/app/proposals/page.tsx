import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusPill } from "@/components/ui/StatusPill";
import { BarMeter } from "@/components/ui/BarMeter";
import { proposals } from "@/lib/mock";

const PHASES = [
  "PLANNING",
  "OUTLINING",
  "DRAFTING",
  "PINK_TEAM",
  "REVISING",
  "RED_TEAM",
  "GOLD_TEAM",
  "FINAL_REVIEW",
  "PRODUCTION",
  "SUBMITTED",
];

const PHASE_TONE: Record<string, string> = {
  PLANNING: "bg-paper",
  OUTLINING: "bg-bone",
  DRAFTING: "bg-cobalt text-paper",
  PINK_TEAM: "bg-[#FF80A8]",
  REVISING: "bg-hazard",
  RED_TEAM: "bg-blood text-paper",
  GOLD_TEAM: "bg-hazard",
  FINAL_REVIEW: "bg-plum text-paper",
  PRODUCTION: "bg-ink text-paper",
  SUBMITTED: "bg-signal",
};

export default function ProposalsListPage() {
  return (
    <>
      <PageHeader
        eyebrow="Proposals — Pipeline"
        title="PROPOSALS"
        subtitle="Every active proposal across capture, drafting, review, and production."
        actions={
          <>
            <button className="brut-btn">Export CSV</button>
            <Link href="/proposals/new" className="brut-btn-hazard">
              + New proposal
            </Link>
          </>
        }
        meta={[
          { label: "Total", value: String(proposals.length).padStart(2, "0") },
          { label: "In draft", value: "01", accent: "hazard" },
          { label: "In review", value: "02", accent: "signal" },
          { label: "At risk", value: "01", accent: "blood" },
        ]}
      />

      <Panel
        title="Kanban — phase view"
        code="PIPE-01"
        dense
        className="mb-6 overflow-hidden"
      >
        <div className="grid grid-cols-10 divide-x-2 divide-ink">
          {PHASES.map((p) => {
            const items = proposals.filter((x) => x.status === p);
            const tone = PHASE_TONE[p] ?? "bg-bone/40";
            return (
              <div key={p} className="min-h-[220px] bg-bone/40">
                <div
                  className={`flex items-center justify-between border-b-2 border-ink px-2 py-1.5 font-mono text-[9px] font-bold uppercase tracking-widest ${tone}`}
                >
                  <span>{p.replace(/_/g, " ")}</span>
                  <span className="opacity-70">{String(items.length).padStart(2, "0")}</span>
                </div>
                <div className="flex flex-col gap-2 p-1.5">
                  {items.map((pr) => (
                    <Link
                      key={pr.id}
                      href={`/proposals/${pr.id}/editor`}
                      className="brut-card-sm block p-2 transition-transform hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-brut"
                    >
                      <div className="font-mono text-[9px] uppercase text-ink/60">{pr.code}</div>
                      <div className="mt-0.5 font-display text-xs font-bold leading-tight">
                        {pr.title}
                      </div>
                      <div
                        className={`mt-2 inline-block border-2 border-ink px-1.5 py-0.5 font-mono text-[9px] font-bold ${
                          pr.daysLeft < 5
                            ? "bg-blood text-paper"
                            : pr.daysLeft < 15
                              ? "bg-hazard"
                              : "bg-paper"
                        }`}
                      >
                        {pr.daysLeft}d
                      </div>
                      <div className="mt-2">
                        <BarMeter value={pr.progress} color="ink" />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="Proposal register" code="PR-00" dense>
        <div className="grid grid-cols-[130px_1fr_140px_110px_120px_110px_100px] border-b-2 border-ink bg-ink font-mono text-[10px] uppercase tracking-[0.2em] text-paper">
          <div className="border-r border-paper/20 p-2">ID · status</div>
          <div className="border-r border-paper/20 p-2">Title / solicitation</div>
          <div className="border-r border-paper/20 p-2">Due</div>
          <div className="border-r border-paper/20 p-2">Progress</div>
          <div className="border-r border-paper/20 p-2">Compliance</div>
          <div className="border-r border-paper/20 p-2">Pages</div>
          <div className="p-2">Open</div>
        </div>
        {proposals.map((p, i) => (
          <div
            key={p.id}
            className={`grid grid-cols-[130px_1fr_140px_110px_120px_110px_100px] items-center border-b-2 border-ink ${
              i % 2 ? "bg-bone" : "bg-paper"
            } hover:bg-hazard/30`}
          >
            <div className="border-r-2 border-ink p-3">
              <div className="font-mono text-[10px] uppercase text-ink/60">{p.code}</div>
              <div className="mt-1">
                <StatusPill value={p.status} />
              </div>
            </div>
            <div className="border-r-2 border-ink p-3">
              <div className="font-display text-base font-bold leading-tight">{p.title}</div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-ink/60">
                {p.solicitation} · {p.agency}
              </div>
              <div className="font-mono text-[10px] uppercase text-ink/60">
                CAP {p.captureManager} · PM {p.proposalManager}
              </div>
            </div>
            <div className="border-r-2 border-ink p-3 font-mono text-[11px]">
              <div className="font-bold uppercase">{p.dueAt.split(" ")[0]}</div>
              <div
                className={`mt-1 border-2 border-ink px-1.5 py-0.5 text-center font-display text-lg font-bold leading-none ${
                  p.daysLeft < 5
                    ? "bg-blood text-paper"
                    : p.daysLeft < 15
                      ? "bg-hazard"
                      : "bg-paper"
                }`}
              >
                {p.daysLeft}d
              </div>
            </div>
            <div className="border-r-2 border-ink p-3">
              <BarMeter value={p.progress} color="ink" right={`${p.progress}%`} />
            </div>
            <div className="border-r-2 border-ink p-3">
              <BarMeter
                value={p.compliancePct}
                color={
                  p.compliancePct >= 90 ? "signal" : p.compliancePct >= 70 ? "hazard" : "blood"
                }
                right={`${p.compliancePct}%`}
              />
            </div>
            <div className="border-r-2 border-ink p-3 font-mono text-[11px]">
              <div className="font-bold">
                {p.pagesEstimated}/{p.pagesLimit}p
              </div>
              <div className="text-[10px] text-ink/60">AI {p.aiPct}%</div>
            </div>
            <div className="p-2">
              <Link
                href={`/proposals/${p.id}/editor`}
                className="brut-btn w-full px-2 py-1 text-[10px]"
              >
                Open
              </Link>
            </div>
          </div>
        ))}
      </Panel>
    </>
  );
}
