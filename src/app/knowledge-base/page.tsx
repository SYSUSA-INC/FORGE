import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { BarMeter } from "@/components/ui/BarMeter";
import { kb } from "@/lib/mock";

const KIND_TONE: Record<string, string> = {
  CAPABILITY: "bg-signal",
  PAST_PERFORMANCE: "bg-hazard",
  PERSONNEL: "bg-cobalt text-paper",
  BOILERPLATE: "bg-bone",
};

export default function KnowledgeBasePage() {
  return (
    <>
      <PageHeader
        eyebrow="KB // CORPORATE MEMORY · pgvector"
        title="KNOWLEDGE BASE"
        subtitle="Embedded capabilities, past performance refs, personnel, and boilerplate — semantically indexed."
        actions={
          <>
            <button className="brut-btn">BULK IMPORT</button>
            <button className="brut-btn">RESUME PARSER</button>
            <button className="brut-btn-hazard">+ NEW ENTRY</button>
          </>
        }
        meta={[
          { label: "ENTRIES", value: "482" },
          { label: "VECTORS", value: "12.4K", accent: "signal" },
          { label: "REUSE · 30D", value: "1,204", accent: "hazard" },
          { label: "STALE >90D", value: "18", accent: "blood" },
        ]}
      />

      <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr_1fr_1fr]">
        <div>
          <div className="brut-label">SEMANTIC QUERY</div>
          <div className="flex">
            <input
              className="brut-input"
              placeholder='e.g. "navy shipboard AI governance past performance"'
            />
            <button className="-ml-0.5 border-2 border-ink bg-ink px-4 font-display text-xs font-bold uppercase text-paper">
              SEARCH
            </button>
          </div>
        </div>
        <div>
          <div className="brut-label">KIND</div>
          <select className="brut-input">
            <option>ANY</option>
            <option>CAPABILITY</option>
            <option>PAST_PERFORMANCE</option>
            <option>PERSONNEL</option>
            <option>BOILERPLATE</option>
          </select>
        </div>
        <div>
          <div className="brut-label">TAG</div>
          <input className="brut-input" placeholder="NAVSEA, ZTA, CMMI…" />
        </div>
        <div>
          <div className="brut-label">MIN SIMILARITY</div>
          <input className="brut-input" placeholder="0.70" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_280px]">
        <Panel title="ENTRIES" code="IDX" dense>
          <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
            {kb.map((e) => (
              <div
                key={e.id}
                className="brut-card-sm group relative flex flex-col gap-2 bg-paper p-3 transition-transform hover:-translate-y-0.5 hover:shadow-brut"
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`brut-pill ${KIND_TONE[e.kind] ?? "bg-paper"}`}
                  >
                    {e.kind.replace("_", " ")}
                  </span>
                  <span className="font-mono text-[10px] text-ink/60">{e.id}</span>
                </div>
                <div className="font-display text-lg font-bold leading-tight">{e.title}</div>
                <div className="font-mono text-[11px] text-ink/70">{e.meta}</div>
                <div className="flex flex-wrap gap-1 pt-1">
                  {e.tags.map((t) => (
                    <span key={t} className="brut-chip bg-bone">#{t}</span>
                  ))}
                </div>
                <div className="mt-auto grid grid-cols-3 gap-1 border-t-2 border-ink pt-2 font-mono text-[10px] uppercase">
                  <div className="border-r-2 border-ink pr-1">
                    <div className="text-ink/60">REUSE</div>
                    <div className="font-display text-base font-bold">{e.reuse}</div>
                  </div>
                  <div className="border-r-2 border-ink pr-1">
                    <div className="text-ink/60">SIM</div>
                    <div className="font-display text-base font-bold">{e.embedding}</div>
                  </div>
                  <div>
                    <div className="text-ink/60">UPDT</div>
                    <div className="font-display text-base font-bold">{e.updated}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <aside className="flex flex-col gap-4">
          <Panel title="VECTOR HEALTH" code="VEC" accent="signal">
            <div className="flex flex-col gap-3 font-mono text-[11px]">
              <div>
                <div className="flex justify-between">
                  <span>INDEX COVERAGE</span>
                  <span className="font-bold">96%</span>
                </div>
                <BarMeter value={96} color="signal" />
              </div>
              <div>
                <div className="flex justify-between">
                  <span>RETRIEVAL HIT RATE</span>
                  <span className="font-bold">78%</span>
                </div>
                <BarMeter value={78} color="hazard" />
              </div>
              <div>
                <div className="flex justify-between">
                  <span>DUPLICATE RISK</span>
                  <span className="font-bold">12%</span>
                </div>
                <BarMeter value={12} color="blood" />
              </div>
            </div>
            <div className="brut-diagonal-hazard mt-3 h-2 border-2 border-ink" />
          </Panel>

          <Panel title="TOP TAGS · 30D" code="TAG" accent="hazard">
            <ul className="flex flex-wrap gap-1">
              {["NAVSEA", "C5ISR", "ZTA", "NIST", "ARMY", "CMMI", "TS/SCI", "FFP", "GOVCLOUD", "IL-5", "AI", "ML", "PMP", "ISO"].map(
                (t) => (
                  <li key={t} className="brut-chip bg-paper">
                    #{t}
                  </li>
                ),
              )}
            </ul>
          </Panel>

          <Panel title="RECENT IMPORTS" code="IMP">
            <ul className="flex flex-col gap-1 font-mono text-[11px]">
              {[
                "RESUME · Dr. H. Bray · 1h",
                "CPARS · LCS Sustainment · 3h",
                "BOILERPLATE · QA Plan · 6h",
                "CAPABILITY · GovCloud IL-5 · 1d",
              ].map((r) => (
                <li key={r} className="border-b border-ink/20 py-1 uppercase">
                  {r}
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>
    </>
  );
}
