import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { BarMeter } from "@/components/ui/BarMeter";
import { DotMeter } from "@/components/ui/DotMeter";
import { BarSpark } from "@/components/ui/Sparkline";
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
        title="KNOWBASE"
        subtitle="Embedded capabilities, past performance refs, personnel, and boilerplate — semantically indexed."
        barcode="KB-INDEX-12K"
        stamp={{ label: "INDEX NOMINAL", tone: "signal" }}
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

      {/* HERO TRIO */}
      <section className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr_1fr]">
        {/* Embedding field (decorative point cloud) */}
        <Panel title="EMBEDDING FIELD · pgvector" code="EMB" accent="cobalt">
          <EmbeddingField />
          <div className="mt-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-ink/60">
            <span>1,024 DIM · DOWN-PROJECTED</span>
            <span>K=12 · NEAREST NEIGHBORS</span>
          </div>
        </Panel>

        <Panel title="CORPUS MAP" code="MAP" accent="hazard">
          <ul className="flex flex-col gap-2 font-mono text-[11px]">
            {[
              { k: "CAPABILITY", v: 144, tone: "bg-signal" },
              { k: "PAST PERFORMANCE", v: 96, tone: "bg-hazard" },
              { k: "PERSONNEL", v: 208, tone: "bg-cobalt text-paper" },
              { k: "BOILERPLATE", v: 34, tone: "bg-bone" },
            ].map((d) => (
              <li key={d.k} className={`relative border-2 border-ink p-2 ${d.tone}`}>
                <div className="flex items-center justify-between">
                  <span className="uppercase tracking-widest">{d.k}</span>
                  <span className="brut-stencil text-2xl leading-none">{d.v}</span>
                </div>
                <DotMeter value={(d.v / 208) * 100} steps={18} filled="bg-ink" />
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="VECTOR HEALTH" code="VEC" accent="signal">
          <div className="flex flex-col gap-3 font-mono text-[11px]">
            <Health label="INDEX COVERAGE" v={96} color="signal" />
            <Health label="RETRIEVAL HIT RATE" v={78} color="hazard" />
            <Health label="DUPLICATE RISK" v={12} color="blood" />
            <Health label="AVG SIMILARITY" v={84} color="ink" />
          </div>

          <div className="mt-4 border-2 border-ink bg-bone p-3">
            <div className="font-mono text-[10px] uppercase tracking-widest text-ink/60">
              ENQUEUED RE-EMBED
            </div>
            <div className="brut-stencil text-3xl leading-none">248</div>
            <div className="mt-2 h-14">
              <BarSpark data={[4, 8, 6, 12, 10, 14, 9, 16, 18, 15, 22, 20]} />
            </div>
          </div>
        </Panel>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_280px]">
        <Panel title="ENTRIES" code="IDX" accent="plum" dense>
          <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
            {kb.map((e) => (
              <div
                key={e.id}
                className="brut-card-sm group relative flex flex-col gap-2 overflow-hidden bg-paper p-3 transition-transform hover:-translate-y-0.5 hover:shadow-brut"
              >
                <div className="flex items-center justify-between">
                  <span className={`brut-pill ${KIND_TONE[e.kind] ?? "bg-paper"}`}>
                    {e.kind.replace("_", " ")}
                  </span>
                  <span className="font-mono text-[10px] text-ink/60">{e.id}</span>
                </div>
                <div className="font-display text-lg font-bold leading-tight">{e.title}</div>
                <div className="font-mono text-[11px] text-ink/70">{e.meta}</div>
                <div className="flex flex-wrap gap-1 pt-1">
                  {e.tags.map((t) => (
                    <span key={t} className="brut-chip bg-bone">
                      #{t}
                    </span>
                  ))}
                </div>

                <div className="mt-auto grid grid-cols-3 gap-1 border-t-2 border-ink pt-2 font-mono text-[10px] uppercase">
                  <div className="border-r-2 border-ink pr-1">
                    <div className="text-ink/60">REUSE</div>
                    <div className="brut-stencil text-base leading-none">{e.reuse}</div>
                  </div>
                  <div className="border-r-2 border-ink pr-1">
                    <div className="text-ink/60">SIM</div>
                    <div className="brut-stencil text-base leading-none">{e.embedding}</div>
                  </div>
                  <div>
                    <div className="text-ink/60">UPDT</div>
                    <div className="brut-stencil text-base leading-none">{e.updated}</div>
                  </div>
                </div>

                {/* Corner hazard */}
                <span className="pointer-events-none absolute right-0 top-0 h-4 w-4 brut-diagonal opacity-30" />
              </div>
            ))}
          </div>
        </Panel>

        <aside className="flex flex-col gap-4">
          <Panel title="TOP TAGS · 30D" code="TAG" accent="hazard">
            <ul className="flex flex-wrap gap-1">
              {[
                "NAVSEA",
                "C5ISR",
                "ZTA",
                "NIST",
                "ARMY",
                "CMMI",
                "TS/SCI",
                "FFP",
                "GOVCLOUD",
                "IL-5",
                "AI",
                "ML",
                "PMP",
                "ISO",
              ].map((t, i) => (
                <li
                  key={t}
                  className={`brut-chip ${i % 5 === 0 ? "bg-hazard" : i % 7 === 0 ? "bg-signal" : "bg-paper"}`}
                >
                  #{t}
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="RECENT IMPORTS" code="IMP" accent="cobalt">
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

          <Panel title="AUDIT NOTICE" code="AUD" accent="blood">
            <p className="font-mono text-[11px] leading-relaxed">
              Every retrieval is logged with <b>query hash</b>, <b>retrieval set</b>, and{" "}
              <b>confidence</b>. Required for federal AI audit trail.
            </p>
            <button className="brut-btn-blood mt-3 w-full text-[10px]">OPEN AUDIT LOG</button>
          </Panel>
        </aside>
      </div>
    </>
  );
}

function Health({
  label,
  v,
  color,
}: {
  label: string;
  v: number;
  color: "signal" | "hazard" | "blood" | "ink";
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span>{label}</span>
        <span className="font-bold">{v}%</span>
      </div>
      <BarMeter value={v} color={color} />
    </div>
  );
}

function EmbeddingField() {
  // deterministic pseudo-random point cloud
  const pts: { x: number; y: number; r: number; c: string }[] = [];
  const rand = mulberry32(42);
  const colors = ["#0A0A0A", "#FFD500", "#00E676", "#1E40FF", "#E63026"];
  for (let i = 0; i < 120; i++) {
    pts.push({
      x: rand() * 100,
      y: rand() * 100,
      r: 1 + rand() * 3,
      c: colors[i % colors.length],
    });
  }

  return (
    <svg viewBox="0 0 100 60" className="h-44 w-full border-2 border-ink bg-paper" preserveAspectRatio="none">
      {/* grid */}
      {[...Array(10)].map((_, i) => (
        <line
          key={`v${i}`}
          x1={i * 10}
          y1={0}
          x2={i * 10}
          y2={60}
          stroke="#0A0A0A"
          strokeOpacity={0.08}
          strokeWidth={0.25}
        />
      ))}
      {[...Array(6)].map((_, i) => (
        <line
          key={`h${i}`}
          x1={0}
          y1={i * 10}
          x2={100}
          y2={i * 10}
          stroke="#0A0A0A"
          strokeOpacity={0.08}
          strokeWidth={0.25}
        />
      ))}
      {/* cluster outlines */}
      <ellipse cx={28} cy={22} rx={20} ry={11} fill="none" stroke="#0A0A0A" strokeWidth={0.6} strokeDasharray="1 1" />
      <ellipse cx={70} cy={38} rx={24} ry={14} fill="none" stroke="#0A0A0A" strokeWidth={0.6} strokeDasharray="1 1" />
      <ellipse cx={50} cy={48} rx={16} ry={8} fill="none" stroke="#0A0A0A" strokeWidth={0.6} strokeDasharray="1 1" />

      {pts.map((p, i) => (
        <circle key={i} cx={p.x * 0.6 + 10 + (i % 3) * 10} cy={p.y * 0.6 + 5} r={p.r * 0.6} fill={p.c} opacity={0.85} />
      ))}

      {/* query marker */}
      <g>
        <circle cx={55} cy={32} r={2.5} fill="#E63026" />
        <circle cx={55} cy={32} r={6} fill="none" stroke="#E63026" strokeWidth={0.7} />
        <text x={58} y={31} fontFamily="var(--font-mono)" fontSize={3.5} fill="#0A0A0A" style={{ letterSpacing: "0.1em" }}>
          QUERY
        </text>
      </g>
    </svg>
  );
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function () {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
