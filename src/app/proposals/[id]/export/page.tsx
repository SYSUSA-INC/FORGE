import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { BarMeter } from "@/components/ui/BarMeter";
import { DotMeter } from "@/components/ui/DotMeter";
import { Perforation } from "@/components/ui/Perforation";
import { proposals } from "@/lib/mock";

export default function ExportPage({ params }: { params: { id: string } }) {
  const p = proposals.find((x) => x.id === params.id) ?? proposals[0];

  return (
    <>
      <PageHeader
        eyebrow={`EXP // ${p.code} · PRODUCTION & FORMAT`}
        title="EXPORT"
        subtitle="PDF/DOCX production with exact formatting. Page limit, font, margin, and image-DPI gates."
        barcode={`${p.code}-PROD`}
        stamp={{ label: "PRODUCTION HOLD", tone: "hazard" }}
        actions={
          <>
            <button className="brut-btn">PREVIEW</button>
            <button className="brut-btn">FORMAT SCAN</button>
            <button className="brut-btn-hazard">BUILD ZIP</button>
          </>
        }
        meta={[
          { label: "PAGES EST", value: `${p.pagesEstimated}/${p.pagesLimit}`, accent: "hazard" },
          { label: "FONT", value: "TNR 12", accent: "signal" },
          { label: "MARGINS", value: "1.0″", accent: "signal" },
          { label: "DPI", value: "300", accent: "signal" },
        ]}
      />

      {/* HERO MANIFEST */}
      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="relative overflow-hidden border-2 border-ink bg-paper shadow-brut-xl">
          <div className="flex items-center justify-between border-b-2 border-ink bg-ink px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.25em] text-paper">
            <span>▸ PROPOSAL MANIFEST</span>
            <span>CUSTODY CHAIN · OK</span>
          </div>
          <div className="brut-sprockets h-3 border-b-2 border-ink" />

          <div className="grid grid-cols-1 gap-0 p-5 md:grid-cols-2">
            <div className="md:border-r-2 md:border-ink md:pr-5">
              <div className="font-mono text-[10px] uppercase tracking-widest text-ink/60">
                PROPOSAL CODE
              </div>
              <div className="brut-stencil text-5xl leading-none">{p.code}</div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-ink/60">
                SOL {p.solicitation}
              </div>

              <div className="mt-4 font-mono text-[11px] leading-relaxed">
                <Row k="TITLE" v={p.title} />
                <Row k="AGENCY" v={p.agency} />
                <Row k="DUE" v={p.dueAt} />
                <Row k="CAPTURE" v={p.captureManager} />
                <Row k="PM" v={p.proposalManager} />
                <Row k="TARGET" v={`${p.pagesLimit}p · TNR 12 · 1.0″`} />
              </div>
            </div>
            <div className="mt-5 md:mt-0 md:pl-5">
              <div className="font-mono text-[10px] uppercase tracking-widest text-ink/60">
                PAGE BUDGET
              </div>
              <div className="flex items-end justify-between">
                <div className="brut-stencil text-6xl leading-none">
                  {p.pagesEstimated}
                </div>
                <div className="pb-2 font-mono text-sm uppercase tracking-widest text-ink/60">
                  / {p.pagesLimit}p
                </div>
              </div>
              <DotMeter
                value={p.pagesEstimated}
                max={p.pagesLimit}
                steps={30}
                filled={p.pagesEstimated > p.pagesLimit * 0.95 ? "bg-blood" : "bg-hazard"}
              />

              <Perforation className="my-4" />

              <div className="grid grid-cols-3 gap-1">
                <Mini k="REV" v="12" tone="ink" />
                <Mini k="VOL" v="05" tone="hazard" />
                <Mini k="STAMPS" v="04" tone="signal" />
              </div>
            </div>
          </div>
          <span
            className="pointer-events-none absolute bottom-8 right-8 border-[3px] border-hazard px-3 py-1 font-display text-[11px] font-black uppercase tracking-[0.22em] text-hazard"
            style={{ transform: "rotate(-6deg)" }}
          >
            ✦ PRODUCTION HOLD ✦
          </span>
        </div>

        <Panel title="PRODUCTION QUEUE" code="QUE" accent="ink">
          <div className="flex flex-col gap-2 font-mono text-[11px]">
            <Queue label="PUPPETEER · HTML→PDF" pct={72} />
            <Queue label="DOCX EMITTER" pct={48} />
            <Queue label="COMPLIANCE MATRIX · XLSX" pct={100} />
            <Queue label="ZIP + MANIFEST" pct={0} />
          </div>

          <div className="mt-4 border-2 border-ink bg-bone p-3 font-mono text-[10px] uppercase tracking-widest">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 animate-blink bg-blood" /> WORKER · 02
              </span>
              <span>3 JOBS</span>
            </div>
            <div className="mt-2 h-16 border-2 border-ink bg-paper">
              <div className="flex h-full">
                <div className="bg-signal" style={{ width: "42%" }} />
                <div className="bg-hazard" style={{ width: "18%" }} />
                <div className="bg-blood" style={{ width: "10%" }} />
                <div className="bg-bone" style={{ width: "30%" }} />
              </div>
            </div>
            <div className="mt-1 flex items-center gap-3 text-[9px] text-ink/70">
              <span className="flex items-center gap-1">
                <span className="h-2 w-3 bg-signal" /> DONE
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-3 bg-hazard" /> RUN
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-3 bg-blood" /> FAIL
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-3 bg-bone" /> QUEUE
              </span>
            </div>
          </div>
        </Panel>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel title="VOLUME BUILDS" code="BLD" dense>
          <div className="divide-y-2 divide-ink">
            {[
              { v: "VOL I", t: "Technical", p: 184, l: 200, s: "BUILDING", c: "hazard" },
              { v: "VOL II", t: "Management", p: 62, l: 80, s: "READY", c: "signal" },
              { v: "VOL III", t: "Past Performance", p: 46, l: 50, s: "READY", c: "signal" },
              { v: "VOL IV", t: "Price", p: 0, l: 0, s: "PENDING", c: "bone" },
              { v: "VOL V", t: "Small Business Subcontracting", p: 14, l: 20, s: "READY", c: "signal" },
            ].map((b) => (
              <div
                key={b.v}
                className="grid grid-cols-[90px_1fr_auto_140px] items-center gap-3 p-4"
              >
                <div className="brut-pill bg-ink text-paper">{b.v}</div>
                <div>
                  <div className="font-display text-lg font-bold uppercase">{b.t}</div>
                  <div className="mt-1">
                    <BarMeter
                      value={b.p}
                      max={Math.max(b.l, 1)}
                      color={b.p > b.l * 0.95 ? "blood" : b.p > 0 ? "ink" : "bone"}
                      right={b.l ? `${b.p}/${b.l}p` : "—"}
                    />
                  </div>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <div className="brut-stencil text-3xl leading-none">{b.p}</div>
                  <div className="font-mono text-[9px] uppercase text-ink/60">PAGES</div>
                </div>
                <div
                  className={`border-2 border-ink px-2 py-1.5 text-center font-mono text-[11px] font-bold uppercase ${
                    b.c === "signal"
                      ? "bg-signal"
                      : b.c === "hazard"
                        ? "bg-hazard"
                        : b.c === "blood"
                          ? "bg-blood text-paper"
                          : "bg-bone"
                  }`}
                >
                  {b.s}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <div className="flex flex-col gap-4">
          <Panel title="FORMAT COMPLIANCE" code="FMT" accent="signal">
            <ul className="flex flex-col gap-2">
              {[
                { k: "PAGE LIMIT", v: "184/200", ok: true },
                { k: "FONT · SERIF 12PT", v: "PASS", ok: true },
                { k: "LINE SPACING", v: "SINGLE", ok: true },
                { k: "MARGINS", v: "1.0″ ALL", ok: true },
                { k: "IMAGES · 300DPI", v: "PASS", ok: true },
                { k: "TABLES · ≥10PT", v: "FAIL · Table 3-1 is 9pt", ok: false },
                { k: "HEADERS · CONSISTENT", v: "WARN · Sec 4.2 orphan", ok: false },
                { k: "FILE · ≤100MB", v: "74.2 MB", ok: true },
              ].map((g) => (
                <li
                  key={g.k}
                  className={`grid grid-cols-[24px_1fr_auto] items-center gap-2 border-2 border-ink p-2 ${
                    g.ok ? "bg-paper" : "bg-hazard"
                  }`}
                >
                  <span
                    className={`grid h-5 w-5 place-items-center border-2 border-ink font-mono text-[11px] font-bold ${
                      g.ok ? "bg-signal" : "bg-blood text-paper"
                    }`}
                  >
                    {g.ok ? "✓" : "!"}
                  </span>
                  <span className="font-mono text-[11px] uppercase">{g.k}</span>
                  <span className="font-mono text-[11px] font-bold">{g.v}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="EXPORT HISTORY" code="HST">
            <ul className="flex flex-col gap-1 font-mono text-[11px]">
              {[
                { n: "FRG-0042_VolI_v12.pdf", t: "12 MIN AGO", s: "PASS", k: "signal" },
                { n: "FRG-0042_VolI_v11.pdf", t: "3H AGO", s: "WARN", k: "hazard" },
                { n: "FRG-0042_Full_v1.zip", t: "1D AGO", s: "DRAFT", k: "bone" },
                { n: "FRG-0042_VolI_v10.pdf", t: "2D AGO", s: "FAIL", k: "blood" },
              ].map((h) => (
                <li
                  key={h.n}
                  className="grid grid-cols-[1fr_90px_90px] items-center gap-2 border-b border-ink/20 py-1.5"
                >
                  <span className="truncate">{h.n}</span>
                  <span className="text-[10px] uppercase text-ink/60">{h.t}</span>
                  <span
                    className={`brut-chip ${
                      h.k === "signal"
                        ? "bg-signal"
                        : h.k === "hazard"
                          ? "bg-hazard"
                          : h.k === "blood"
                            ? "bg-blood text-paper"
                            : "bg-bone"
                    }`}
                  >
                    {h.s}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}

function Queue({ label, pct }: { label: string; pct: number }) {
  return (
    <div>
      <div className="flex justify-between">
        <span className="uppercase tracking-widest">{label}</span>
        <span className="font-bold">{pct}%</span>
      </div>
      <BarMeter value={pct} color={pct === 100 ? "signal" : pct > 0 ? "hazard" : "bone"} />
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[90px_1fr] items-start gap-3 border-b border-ink/15 py-1">
      <span className="uppercase text-ink/60">{k}</span>
      <span className="font-bold">{v}</span>
    </div>
  );
}

function Mini({ k, v, tone }: { k: string; v: string; tone: "ink" | "hazard" | "signal" }) {
  const bg =
    tone === "ink"
      ? "bg-ink text-paper"
      : tone === "hazard"
        ? "bg-hazard text-ink"
        : "bg-signal text-ink";
  return (
    <div className={`border-2 border-ink p-2 text-center ${bg}`}>
      <div className="font-mono text-[9px] uppercase tracking-widest opacity-80">{k}</div>
      <div className="brut-stencil text-2xl leading-none">{v}</div>
    </div>
  );
}
