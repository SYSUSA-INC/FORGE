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

export default function ProposalsListPage() {
  return (
    <>
      <PageHeader
        eyebrow="PRP // PROPOSAL PIPELINE"
        title="PROPOSALS"
        subtitle="Every active proposal across capture, drafting, review, and production."
        actions={
          <>
            <button className="brut-btn">EXPORT CSV</button>
            <Link href="/proposals/new" className="brut-btn-hazard">
              + NEW PROPOSAL
            </Link>
          </>
        }
        meta={[
          { label: "TOTAL", value: String(proposals.length).padStart(2, "0") },
          { label: "IN DRAFT", value: "01", accent: "hazard" },
          { label: "IN REVIEW", value: "02", accent: "signal" },
          { label: "AT RISK", value: "01", accent: "blood" },
        ]}
      />

      <Panel title="KANBAN · PHASE VIEW" code="PIPE-01" dense className="mb-6 overflow-hidden">
        <div className="grid grid-cols-10 divide-x-2 divide-ink">
          {PHASES.map((p) => {
            const items = proposals.filter((x) => x.status === p);
            return (
              <div key={p} className="min-h-[180px] bg-bone/40">
                <div className="border-b-2 border-ink bg-ink px-2 py-1.5 font-mono text-[9px] font-bold uppercase tracking-widest text-paper">
                  {p.replace(/_/g, " ")}
                  <span className="ml-1 opacity-60">·{String(items.length).padStart(2, "0")}</span>
                </div>
                <div className="flex flex-col gap-2 p-1.5">
                  {items.map((pr) => (
                    <Link
                      key={pr.id}
                      href={`/proposals/${pr.id}/editor`}
                      className="brut-card-sm block p-2"
                    >
                      <div className="font-mono text-[9px] uppercase text-ink/60">{pr.code}</div>
                      <div className="mt-0.5 font-display text-xs font-bold leading-tight">
                        {pr.title}
                      </div>
                      <div className="mt-1 font-mono text-[9px] uppercase text-ink/60">
                        T-{pr.daysLeft}D
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="PROPOSAL REGISTER" code="PR-00" dense>
        <div className="grid grid-cols-[130px_1fr_140px_110px_120px_110px_100px] border-b-2 border-ink bg-ink font-mono text-[10px] uppercase tracking-[0.2em] text-paper">
          <div className="border-r border-paper/20 p-2">ID · STATUS</div>
          <div className="border-r border-paper/20 p-2">TITLE / SOL</div>
          <div className="border-r border-paper/20 p-2">DUE</div>
          <div className="border-r border-paper/20 p-2">PROGRESS</div>
          <div className="border-r border-paper/20 p-2">COMPLIANCE</div>
          <div className="border-r border-paper/20 p-2">PAGES</div>
          <div className="p-2">OPEN</div>
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
                className={`mt-0.5 border-2 border-ink px-1.5 py-0.5 text-center text-[10px] font-bold uppercase ${
                  p.daysLeft < 5 ? "bg-blood text-paper" : p.daysLeft < 15 ? "bg-hazard" : "bg-paper"
                }`}
              >
                T-{p.daysLeft}D
              </div>
            </div>
            <div className="border-r-2 border-ink p-3">
              <BarMeter value={p.progress} color="ink" right={`${p.progress}%`} />
            </div>
            <div className="border-r-2 border-ink p-3">
              <BarMeter
                value={p.compliancePct}
                color={p.compliancePct >= 90 ? "signal" : p.compliancePct >= 70 ? "hazard" : "blood"}
                right={`${p.compliancePct}%`}
              />
            </div>
            <div className="border-r-2 border-ink p-3 font-mono text-[11px]">
              <div className="font-bold">
                {p.pagesEstimated}/{p.pagesLimit}p
              </div>
              <div className="text-[10px] text-ink/60">
                AI {p.aiPct}%
              </div>
            </div>
            <div className="p-2">
              <Link href={`/proposals/${p.id}/editor`} className="brut-btn w-full px-2 py-1 text-[10px]">
                OPEN →
              </Link>
            </div>
          </div>
        ))}
      </Panel>
    </>
  );
}
