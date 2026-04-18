import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusPill } from "@/components/ui/StatusPill";
import { DotMeter } from "@/components/ui/DotMeter";
import { HeatGrid } from "@/components/ui/HeatGrid";
import { solicitations } from "@/lib/mock";

export default function SolicitationsListPage() {
  // bucket P(win) distribution for the spectrum viz
  const buckets = [0, 0, 0, 0, 0];
  for (const s of solicitations) {
    const i = Math.min(4, Math.floor(s.pWin / 20));
    buckets[i]++;
  }

  return (
    <>
      <PageHeader
        eyebrow="SOL // SOLICITATION INTAKE & TRIAGE"
        title="SOLICIT."
        subtitle="Intake raw solicitation documents. Extract Section L & M. Assign bid/no-bid decisions."
        barcode="SOL-REG-0094"
        stamp={{ label: "TRIAGE OPEN", tone: "hazard" }}
        actions={
          <>
            <button className="brut-btn">IMPORT · SAM.GOV</button>
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

      {/* Filter row with big search */}
      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr_1fr_1fr]">
        <div>
          <div className="brut-label">SEARCH</div>
          <div className="flex">
            <input
              className="brut-input"
              placeholder='query e.g. NAVSEA, 541512, "zero trust", T&M…'
            />
            <button className="-ml-0.5 border-2 border-ink bg-ink px-4 font-display text-xs font-bold uppercase text-paper">
              GO
            </button>
          </div>
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

      {/* Triptych: P(WIN) spectrum / agency heat / intake velocity */}
      <section className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="P(WIN) SPECTRUM" code="PW-01" accent="hazard">
          <div className="flex items-end gap-2">
            {buckets.map((n, i) => (
              <div key={i} className="flex flex-1 flex-col items-center">
                <div className="relative flex h-24 w-full items-end">
                  <div
                    className={`w-full border-2 border-ink ${
                      i === 0
                        ? "bg-blood"
                        : i === 1
                          ? "bg-rust"
                          : i === 2
                            ? "bg-hazard"
                            : i === 3
                              ? "bg-signal"
                              : "bg-ink"
                    }`}
                    style={{ height: `${Math.max(6, n * 30)}%` }}
                  />
                </div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-widest">
                  {i * 20}–{i * 20 + 20}
                </div>
                <div className="brut-stencil text-xl leading-none">{n}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 border-2 border-ink bg-bone p-2 font-mono text-[10px] uppercase tracking-widest text-ink/70">
            COLD <span className="mx-1 inline-block h-2 w-24 brut-diagonal-hazard align-middle" /> HOT
          </div>
        </Panel>

        <Panel title="AGENCY × NAICS HEAT" code="AX-02" accent="plum">
          <HeatGrid
            rows={["NAVY", "ARMY", "GSA", "DOS", "HHS"]}
            cols={["541511", "541512", "541519", "541330", "OTHER"]}
            matrix={[
              [0, 3, 0, 1, 0],
              [0, 0, 0, 4, 1],
              [0, 5, 1, 0, 1],
              [0, 0, 2, 0, 0],
              [1, 0, 0, 0, 1],
            ]}
          />
        </Panel>

        <Panel title="INTAKE VELOCITY · 14D" code="IN-03" accent="signal">
          <div className="mb-2 flex items-end justify-between">
            <div className="brut-stencil text-5xl leading-none">47</div>
            <span className="brut-chip bg-signal">+12 WoW</span>
          </div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-ink/60">
            NEW INTAKES / FORTNIGHT
          </div>

          <div className="mt-4 flex h-24 items-end gap-1 border-2 border-ink p-1">
            {[3, 4, 2, 6, 5, 4, 7, 5, 8, 6, 9, 7, 10, 8].map((v, i) => (
              <div
                key={i}
                className={`flex-1 ${i === 12 ? "bg-blood" : "bg-ink"}`}
                style={{ height: `${(v / 10) * 100}%` }}
              />
            ))}
          </div>

          <div className="mt-3 grid grid-cols-3 gap-1 font-mono text-[10px] uppercase">
            <div className="border-2 border-ink bg-paper p-1.5">
              <div className="text-ink/60">RFP</div>
              <div className="brut-stencil text-lg leading-none">23</div>
            </div>
            <div className="border-2 border-ink bg-hazard p-1.5">
              <div className="opacity-70">RFQ</div>
              <div className="brut-stencil text-lg leading-none">14</div>
            </div>
            <div className="border-2 border-ink bg-cobalt p-1.5 text-paper">
              <div className="opacity-80">SS</div>
              <div className="brut-stencil text-lg leading-none">10</div>
            </div>
          </div>
        </Panel>
      </section>

      <Panel title="SOLICITATION REGISTER" code="SOL-00" dense>
        <div className="grid grid-cols-[120px_1fr_140px_100px_120px_120px_100px_110px] items-stretch border-b-2 border-ink bg-ink font-mono text-[10px] uppercase tracking-[0.2em] text-paper">
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
            className={`grid grid-cols-[120px_1fr_140px_100px_120px_120px_100px_110px] items-center border-b-2 border-ink ${
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
              <div className="text-[10px] uppercase text-ink/60">
                {s.dueAt.split(" ").slice(1).join(" ")}
              </div>
            </div>
            <div className="border-r-2 border-ink p-3 font-mono text-[11px]">{s.naics}</div>
            <div className="border-r-2 border-ink p-3 font-mono text-[12px] font-bold">
              {s.value}
            </div>
            <div className="border-r-2 border-ink p-3">
              <DotMeter
                value={s.pWin}
                steps={10}
                filled={s.pWin >= 60 ? "bg-signal" : s.pWin >= 40 ? "bg-hazard" : "bg-blood"}
              />
              <div className="mt-1 flex items-center justify-between font-mono text-[10px]">
                <span className="text-ink/60">P(W)</span>
                <span className="font-bold">{s.pWin}%</span>
              </div>
            </div>
            <div className="border-r-2 border-ink p-3">
              <StatusPill value={s.bidDecision} />
            </div>
            <div className="p-2">
              <Link
                href={`/solicitations/${s.id}`}
                className="brut-btn w-full px-2 py-1 text-[10px]"
              >
                OPEN →
              </Link>
            </div>
          </div>
        ))}
      </Panel>
    </>
  );
}
