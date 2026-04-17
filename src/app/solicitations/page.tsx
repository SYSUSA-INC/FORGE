import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusPill } from "@/components/ui/StatusPill";
import { solicitations } from "@/lib/mock";

export default function SolicitationsListPage() {
  return (
    <>
      <PageHeader
        eyebrow="SOL // SOLICITATION INTAKE & TRIAGE"
        title="SOLICITATIONS"
        subtitle="Intake raw solicitation documents. Extract Section L & M. Assign bid/no-bid decisions."
        actions={
          <>
            <button className="brut-btn">IMPORT FROM SAM.GOV</button>
            <Link href="/solicitations/new" className="brut-btn-hazard">
              + INTAKE FILE
            </Link>
          </>
        }
        meta={[
          { label: "TOTAL ACTIVE", value: String(solicitations.length).padStart(2, "0") },
          { label: "FLAGGED BID", value: "02", accent: "signal" },
          { label: "UNDER REVIEW", value: "02", accent: "hazard" },
          { label: "AMENDMENTS · 7D", value: "07", accent: "blood" },
        ]}
      />

      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr_1fr_1fr]">
        <div>
          <div className="brut-label">SEARCH</div>
          <input
            className="brut-input"
            placeholder="query e.g. NAVSEA, 541512, zero trust, T&M..."
          />
        </div>
        <div>
          <div className="brut-label">TYPE</div>
          <select className="brut-input">
            <option>ANY</option>
            <option>RFP</option>
            <option>RFI</option>
            <option>RFQ</option>
            <option>SOURCES SOUGHT</option>
          </select>
        </div>
        <div>
          <div className="brut-label">BID DECISION</div>
          <select className="brut-input">
            <option>ANY</option>
            <option>BID</option>
            <option>NO BID</option>
            <option>REVIEW</option>
          </select>
        </div>
        <div>
          <div className="brut-label">NAICS</div>
          <input className="brut-input" placeholder="541512" />
        </div>
      </div>

      <Panel title="SOLICITATION REGISTER" code="SOL-00" dense>
        <div className="grid grid-cols-[120px_1fr_140px_100px_120px_90px_100px_110px] items-stretch border-b-2 border-ink bg-ink font-mono text-[10px] uppercase tracking-[0.2em] text-paper">
          <div className="border-r border-paper/20 p-2">TYPE · ID</div>
          <div className="border-r border-paper/20 p-2">TITLE / AGENCY</div>
          <div className="border-r border-paper/20 p-2">DUE</div>
          <div className="border-r border-paper/20 p-2">NAICS</div>
          <div className="border-r border-paper/20 p-2">VALUE</div>
          <div className="border-r border-paper/20 p-2">P(WIN)</div>
          <div className="border-r border-paper/20 p-2">DECISION</div>
          <div className="p-2">ACTIONS</div>
        </div>

        {solicitations.map((s, i) => (
          <div
            key={s.id}
            className={`grid grid-cols-[120px_1fr_140px_100px_120px_90px_100px_110px] items-center border-b-2 border-ink ${
              i % 2 ? "bg-bone" : "bg-paper"
            } hover:bg-hazard/30`}
          >
            <div className="border-r-2 border-ink p-3">
              <div className="brut-pill bg-paper">{s.type}</div>
              <div className="mt-1 font-mono text-[10px] uppercase text-ink/60">{s.id}</div>
            </div>
            <Link href={`/solicitations/${s.id}`} className="border-r-2 border-ink p-3">
              <div className="font-display text-base font-bold leading-tight">
                {s.title}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-ink/60">
                {s.number} · {s.agency}
              </div>
            </Link>
            <div className="border-r-2 border-ink p-3 font-mono text-[11px]">
              <div className="font-bold uppercase">{s.dueAt.split(" ")[0]}</div>
              <div className="text-[10px] uppercase text-ink/60">{s.dueAt.split(" ").slice(1).join(" ")}</div>
            </div>
            <div className="border-r-2 border-ink p-3 font-mono text-[11px]">{s.naics}</div>
            <div className="border-r-2 border-ink p-3 font-mono text-[12px] font-bold">
              {s.value}
            </div>
            <div className="border-r-2 border-ink p-3">
              <PWin pct={s.pWin} />
            </div>
            <div className="border-r-2 border-ink p-3">
              <StatusPill value={s.bidDecision} />
            </div>
            <div className="p-2">
              <Link href={`/solicitations/${s.id}`} className="brut-btn w-full px-2 py-1 text-[10px]">
                OPEN →
              </Link>
            </div>
          </div>
        ))}
      </Panel>
    </>
  );
}

function PWin({ pct }: { pct: number }) {
  const color = pct >= 60 ? "bg-signal" : pct >= 40 ? "bg-hazard" : "bg-blood";
  return (
    <div className="flex items-center gap-2">
      <div className="h-5 w-10 border-2 border-ink bg-paper">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-[11px] font-bold">{pct}%</span>
    </div>
  );
}
