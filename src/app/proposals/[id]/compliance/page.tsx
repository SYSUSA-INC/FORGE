import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusPill } from "@/components/ui/StatusPill";
import { BarMeter } from "@/components/ui/BarMeter";
import { DotMeter } from "@/components/ui/DotMeter";
import { proposals, requirements } from "@/lib/mock";

export default function CompliancePage({ params }: { params: { id: string } }) {
  const p = proposals.find((x) => x.id === params.id) ?? proposals[0];

  const buckets = {
    FULLY: requirements.filter((r) => r.compliance === "FULLY").length,
    PARTIALLY: requirements.filter((r) => r.compliance === "PARTIALLY").length,
    NOT_ADDRESSED: requirements.filter((r) => r.compliance === "NOT_ADDRESSED").length,
    VERIFIED: requirements.filter((r) => r.compliance === "VERIFIED").length,
    "N/A": requirements.filter((r) => r.compliance === "N/A").length,
    NON_COMPLIANT: requirements.filter((r) => r.compliance === "NON_COMPLIANT").length,
  };

  return (
    <>
      <PageHeader
        eyebrow={`${p.code} · Compliance`}
        title="Compliance"
        subtitle="Requirements extracted from Section L / M mapped to proposal sections, with live gap analysis."
        actions={
          <>
            <button className="brut-btn">Run AI check</button>
            <button className="brut-btn">Export XLSX</button>
            <button className="brut-btn-primary">Auto-assign</button>
          </>
        }
        meta={[
          { label: "Overall", value: `${p.compliancePct}%`, accent: "signal" },
          { label: "Mandatory", value: "46 / 52" },
          { label: "Gaps", value: "06", accent: "blood" },
          { label: "Verified", value: "18" },
        ]}
      />

      {/* Data-freshness bar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-2 border-ink bg-bone px-4 py-2 font-mono text-[11px] text-ink/70">
        <span>
          Matrix last rebuilt{" "}
          <span className="font-bold text-ink">4 min ago</span> against solicitation{" "}
          <span className="font-bold text-ink">{p.solicitation}</span>, amendment 04.
        </span>
        <span className="flex items-center gap-3">
          <span>Target ≥ 95%</span>
          <span className="text-ink/40">·</span>
          <span>
            Trend <span className="bg-signal px-1 font-bold text-ink">▲ +4.1 WoW</span>
          </span>
        </span>
      </div>

      {/* Summary row */}
      <section className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_2fr]">
        <div className="border-2 border-ink bg-paper shadow-brut">
          <header className="flex items-center justify-between border-b-2 border-ink bg-paper px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em]">
            <span>Overall compliance</span>
            <span className="text-ink/50">Target ≥ 95%</span>
          </header>
          <div className="p-5">
            <div className="flex items-end gap-3">
              <div className="font-display text-6xl font-bold tabular-nums leading-none">
                {p.compliancePct}
              </div>
              <div className="pb-2 font-display text-2xl font-bold text-ink/50">%</div>
              <div className="ml-auto pb-2 text-right font-mono text-[10px] uppercase tracking-widest text-ink/60">
                <div>46 / 52 mandatory</div>
                <div className="mt-0.5">6 open gaps</div>
              </div>
            </div>
            <DotMeter
              value={p.compliancePct}
              steps={30}
              filled="bg-ink"
              empty="bg-paper"
              className="mt-4"
            />
            <div className="mt-4 grid grid-cols-3 gap-2">
              <Gauge k="Mandatory" n="46 / 52" />
              <Gauge k="Critical gaps" n="06" tone="blood" />
              <Gauge k="Verified" n="18" tone="signal" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {(
            [
              ["VERIFIED", "ink"],
              ["FULLY", "signal"],
              ["PARTIALLY", "hazard"],
              ["NOT_ADDRESSED", "blood"],
              ["NON_COMPLIANT", "blood"],
              ["N/A", "bone"],
            ] as const
          ).map(([k, tone]) => (
            <div key={k} className="border-2 border-ink bg-paper shadow-brut-sm">
              <div
                className={`border-b-2 border-ink px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-widest ${
                  tone === "signal"
                    ? "bg-signal"
                    : tone === "hazard"
                      ? "bg-hazard"
                      : tone === "blood"
                        ? "bg-blood text-paper"
                        : tone === "ink"
                          ? "bg-ink text-paper"
                          : "bg-bone"
                }`}
              >
                {k.replace("_", " ").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase())}
              </div>
              <div className="p-3">
                <div className="font-display text-4xl font-bold tabular-nums leading-none">
                  {String(buckets[k as keyof typeof buckets]).padStart(2, "0")}
                </div>
                <div className="mt-1 font-mono text-[10px] uppercase text-ink/60">
                  requirements
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_280px]">
        <Panel title="Compliance matrix" dense>
          <div className="grid grid-cols-[80px_130px_1fr_180px_130px_120px] border-b-2 border-ink bg-ink font-mono text-[10px] uppercase tracking-[0.2em] text-paper">
            <div className="border-r border-paper/20 p-2">Ref</div>
            <div className="border-r border-paper/20 p-2">Category</div>
            <div className="border-r border-paper/20 p-2">Requirement</div>
            <div className="border-r border-paper/20 p-2">Mapped section</div>
            <div className="border-r border-paper/20 p-2">Assignee</div>
            <div className="p-2">Compliance</div>
          </div>
          {requirements.map((r, i) => (
            <div
              key={r.id}
              className={`grid grid-cols-[80px_130px_1fr_180px_130px_120px] border-b-2 border-ink ${
                i % 2 ? "bg-bone" : "bg-paper"
              } ${r.compliance === "NOT_ADDRESSED" ? "ring-2 ring-inset ring-blood" : ""}`}
            >
              <div className="border-r-2 border-ink p-3 font-mono text-[11px] font-bold">
                {r.ref}
              </div>
              <div className="border-r-2 border-ink p-3">
                <StatusPill value={r.category} />
              </div>
              <div className="border-r-2 border-ink p-3 text-sm leading-snug">{r.text}</div>
              <div className="border-r-2 border-ink p-3 font-mono text-[11px]">{r.section}</div>
              <div className="border-r-2 border-ink p-3 font-mono text-[11px]">{r.assignee}</div>
              <div className="p-3">
                <StatusPill value={r.compliance} />
              </div>
            </div>
          ))}
        </Panel>

        <aside className="flex flex-col gap-4">
          <Panel title="Gap analysis">
            <ul className="flex flex-col gap-2">
              {requirements
                .filter(
                  (r) => r.compliance === "NOT_ADDRESSED" || r.compliance === "PARTIALLY",
                )
                .map((r) => (
                  <li
                    key={r.id}
                    className="relative border-2 border-ink bg-paper p-2 font-mono text-[11px]"
                  >
                    <span
                      className={`absolute left-0 top-0 h-full w-1 ${
                        r.compliance === "NOT_ADDRESSED" ? "bg-blood" : "bg-hazard"
                      }`}
                      aria-hidden
                    />
                    <div className="flex items-center justify-between pl-2">
                      <span className="font-bold">{r.ref}</span>
                      <StatusPill value={r.compliance} />
                    </div>
                    <div className="mt-1 pl-2 text-[11px] leading-snug">
                      {r.text.slice(0, 120)}…
                    </div>
                    <div className="mt-1 pl-2 text-[9px] uppercase text-ink/60">
                      {r.section}
                    </div>
                  </li>
                ))}
            </ul>
          </Panel>

          <Panel title="Volume health">
            <div className="flex flex-col gap-3 font-mono text-[11px]">
              <div>
                <div className="flex items-center justify-between">
                  <span>Vol I · Technical</span>
                  <span className="font-bold">78%</span>
                </div>
                <BarMeter value={78} color="signal" />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span>Vol II · Management</span>
                  <span className="font-bold">84%</span>
                </div>
                <BarMeter value={84} color="signal" />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span>Vol III · Past performance</span>
                  <span className="font-bold">62%</span>
                </div>
                <BarMeter value={62} color="hazard" />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span>Vol IV · Price</span>
                  <span className="font-bold">0%</span>
                </div>
                <BarMeter value={2} color="blood" />
              </div>
            </div>
          </Panel>

          <Panel title="Format gates">
            <ul className="flex flex-col gap-1 font-mono text-[11px]">
              {[
                { k: "Page limit · 200", v: "184 · OK", ok: true },
                { k: "Font · TNR 12", v: "Pass", ok: true },
                { k: "Margins · 1.0 in", v: "Pass", ok: true },
                { k: "Table font · ≥10", v: "Warn · 9pt in T3-1", ok: false },
                { k: "Images · 300 dpi", v: "Pass", ok: true },
              ].map((g) => (
                <li
                  key={g.k}
                  className="flex items-center justify-between border-b border-ink/20 py-1"
                >
                  <span>{g.k}</span>
                  <span className={`brut-chip ${g.ok ? "bg-signal" : "bg-hazard"}`}>
                    {g.v}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>
    </>
  );
}

function Gauge({
  k,
  n,
  tone,
}: {
  k: string;
  n: string;
  tone?: "blood" | "signal" | "hazard";
}) {
  const bg =
    tone === "blood"
      ? "bg-blood text-paper"
      : tone === "signal"
        ? "bg-signal text-ink"
        : tone === "hazard"
          ? "bg-hazard text-ink"
          : "bg-paper text-ink";
  return (
    <div className={`border-2 border-ink p-2 ${bg}`}>
      <div className="font-mono text-[9px] uppercase tracking-widest opacity-80">{k}</div>
      <div className="mt-0.5 font-display text-xl font-bold leading-none">{n}</div>
    </div>
  );
}
