import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { BarMeter } from "@/components/ui/BarMeter";
import { DotMeter } from "@/components/ui/DotMeter";
import { proposals } from "@/lib/mock";

export default function ExportPage({ params }: { params: { id: string } }) {
  const p = proposals.find((x) => x.id === params.id) ?? proposals[0];

  return (
    <>
      <PageHeader
        eyebrow={`Export · ${p.code}`}
        title="Export"
        subtitle="PDF / DOCX production with exact formatting. Page limit, font, margin, and image-DPI gates."
        actions={
          <>
            <button className="brut-btn">Preview</button>
            <button className="brut-btn">Format scan</button>
            <button className="brut-btn-hazard">Build ZIP</button>
          </>
        }
        meta={[
          {
            label: "Pages estimated",
            value: `${p.pagesEstimated} / ${p.pagesLimit}`,
            accent: "hazard",
          },
          { label: "Font", value: "TNR 12", accent: "signal" },
          { label: "Margins", value: "1.0″", accent: "signal" },
          { label: "Image DPI", value: "300", accent: "signal" },
        ]}
      />

      {/* Manifest + queue */}
      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="border-2 border-ink bg-paper shadow-brut">
          <div className="flex items-center justify-between border-b-2 border-ink bg-ink px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-paper">
            <span>Proposal manifest</span>
            <span className="opacity-70">{p.code}</span>
          </div>
          <div className="grid grid-cols-1 gap-0 p-5 md:grid-cols-2">
            <div className="md:border-r-2 md:border-ink md:pr-5">
              <div className="font-mono text-[10px] uppercase tracking-widest text-ink/60">
                Proposal code
              </div>
              <div className="font-display text-4xl font-bold leading-none tracking-tight">
                {p.code}
              </div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-ink/60">
                Solicitation {p.solicitation}
              </div>
              <div className="mt-4 font-mono text-[11px] leading-relaxed">
                <Row k="Title" v={p.title} />
                <Row k="Agency" v={p.agency} />
                <Row k="Due" v={p.dueAt} />
                <Row k="Capture" v={p.captureManager} />
                <Row k="PM" v={p.proposalManager} />
                <Row k="Target" v={`${p.pagesLimit}p · TNR 12 · 1.0″`} />
              </div>
            </div>
            <div className="mt-5 md:mt-0 md:pl-5">
              <div className="font-mono text-[10px] uppercase tracking-widest text-ink/60">
                Page budget
              </div>
              <div className="flex items-end justify-between">
                <div className="font-display text-5xl font-bold leading-none">
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
                filled={p.pagesEstimated > p.pagesLimit * 0.95 ? "bg-blood" : "bg-ink"}
              />
              <div className="mt-4 grid grid-cols-3 gap-1">
                <Mini k="Revision" v="12" />
                <Mini k="Volumes" v="05" />
                <Mini k="Stamps" v="04" />
              </div>
            </div>
          </div>
        </div>

        <Panel title="Production queue" code="QUE">
          <div className="flex flex-col gap-2 font-mono text-[11px]">
            <Queue label="Puppeteer · HTML → PDF" pct={72} />
            <Queue label="DOCX emitter" pct={48} />
            <Queue label="Compliance matrix · XLSX" pct={100} />
            <Queue label="ZIP + manifest" pct={0} />
          </div>

          <div className="mt-4 border-2 border-ink bg-bone p-3 font-mono text-[10px] uppercase tracking-widest">
            <div className="flex items-center justify-between">
              <span>Worker · 02</span>
              <span>3 jobs</span>
            </div>
            <div className="mt-2 h-14 border-2 border-ink bg-paper">
              <div className="flex h-full">
                <div className="bg-signal" style={{ width: "42%" }} />
                <div className="bg-hazard" style={{ width: "18%" }} />
                <div className="bg-blood" style={{ width: "10%" }} />
                <div className="bg-bone" style={{ width: "30%" }} />
              </div>
            </div>
            <div className="mt-1 flex items-center gap-3 text-[9px] text-ink/70">
              <span className="flex items-center gap-1">
                <span className="h-2 w-3 bg-signal" /> Done
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-3 bg-hazard" /> Running
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-3 bg-blood" /> Failed
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-3 bg-bone" /> Queued
              </span>
            </div>
          </div>
        </Panel>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel title="Volume builds" code="BLD" dense>
          <div className="divide-y-2 divide-ink">
            {[
              { v: "Vol I", t: "Technical", p: 184, l: 200, s: "Building", c: "hazard" },
              { v: "Vol II", t: "Management", p: 62, l: 80, s: "Ready", c: "signal" },
              { v: "Vol III", t: "Past performance", p: 46, l: 50, s: "Ready", c: "signal" },
              { v: "Vol IV", t: "Price", p: 0, l: 0, s: "Pending", c: "bone" },
              {
                v: "Vol V",
                t: "Small business subcontracting",
                p: 14,
                l: 20,
                s: "Ready",
                c: "signal",
              },
            ].map((b) => (
              <div
                key={b.v}
                className="grid grid-cols-[90px_1fr_auto_140px] items-center gap-3 p-4"
              >
                <div className="brut-pill bg-ink text-paper">{b.v}</div>
                <div>
                  <div className="font-display text-lg font-bold">{b.t}</div>
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
                  <div className="font-display text-2xl font-bold leading-none">{b.p}</div>
                  <div className="font-mono text-[9px] uppercase text-ink/60">Pages</div>
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
          <Panel title="Format compliance" code="FMT">
            <ul className="flex flex-col gap-2">
              {[
                { k: "Page limit", v: "184 / 200", ok: true },
                { k: "Font · Serif 12pt", v: "Pass", ok: true },
                { k: "Line spacing", v: "Single", ok: true },
                { k: "Margins", v: "1.0″ all sides", ok: true },
                { k: "Images · 300 DPI", v: "Pass", ok: true },
                { k: "Tables · ≥10 pt", v: "Fail · Table 3-1 is 9pt", ok: false },
                { k: "Headers · consistent", v: "Warn · §4.2 orphan", ok: false },
                { k: "File size · ≤100 MB", v: "74.2 MB", ok: true },
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
                  <span className="font-mono text-[11px]">{g.k}</span>
                  <span className="font-mono text-[11px] font-bold">{g.v}</span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Export history" code="HST">
            <ul className="flex flex-col gap-1 font-mono text-[11px]">
              {[
                { n: "FRG-0042_VolI_v12.pdf", t: "12 min ago", s: "Pass", k: "signal" },
                { n: "FRG-0042_VolI_v11.pdf", t: "3 h ago", s: "Warn", k: "hazard" },
                { n: "FRG-0042_Full_v1.zip", t: "1 d ago", s: "Draft", k: "bone" },
                { n: "FRG-0042_VolI_v10.pdf", t: "2 d ago", s: "Fail", k: "blood" },
              ].map((h) => (
                <li
                  key={h.n}
                  className="grid grid-cols-[1fr_100px_90px] items-center gap-2 border-b border-ink/20 py-1.5"
                >
                  <span className="truncate">{h.n}</span>
                  <span className="text-[10px] text-ink/60">{h.t}</span>
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
        <span>{label}</span>
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

function Mini({ k, v }: { k: string; v: string }) {
  return (
    <div className="border-2 border-ink bg-paper p-2 text-center">
      <div className="font-mono text-[9px] uppercase tracking-widest text-ink/60">{k}</div>
      <div className="font-display text-xl font-bold leading-none">{v}</div>
    </div>
  );
}
