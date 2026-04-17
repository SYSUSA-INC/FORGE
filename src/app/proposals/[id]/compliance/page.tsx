import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusPill } from "@/components/ui/StatusPill";
import { BarMeter } from "@/components/ui/BarMeter";
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
        eyebrow={`CMP // ${p.code} · COMPLIANCE MATRIX`}
        title="COMPLIANCE"
        subtitle="Requirements extracted from Section L/M mapped to proposal sections. Gap analysis live."
        actions={
          <>
            <button className="brut-btn">RUN AI CHECK</button>
            <button className="brut-btn">EXPORT XLSX</button>
            <button className="brut-btn-hazard">AUTO-ASSIGN</button>
          </>
        }
        meta={[
          { label: "OVERALL", value: `${p.compliancePct}%`, accent: "signal" },
          { label: "MANDATORY", value: "46/52", accent: "hazard" },
          { label: "GAPS", value: "06", accent: "blood" },
          { label: "VERIFIED", value: "18" },
        ]}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-6">
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
              {k.replace("_", " ")}
            </div>
            <div className="p-3">
              <div className="font-display text-4xl font-bold leading-none">
                {String(buckets[k as keyof typeof buckets]).padStart(2, "0")}
              </div>
              <div className="mt-1 font-mono text-[10px] uppercase text-ink/60">REQS</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_280px]">
        <Panel title="COMPLIANCE MATRIX" code="MTX" dense>
          <div className="grid grid-cols-[80px_130px_1fr_180px_130px_120px] border-b-2 border-ink bg-ink font-mono text-[10px] uppercase tracking-[0.2em] text-paper">
            <div className="border-r border-paper/20 p-2">REF</div>
            <div className="border-r border-paper/20 p-2">CATEGORY</div>
            <div className="border-r border-paper/20 p-2">REQUIREMENT</div>
            <div className="border-r border-paper/20 p-2">MAPPED SECTION</div>
            <div className="border-r border-paper/20 p-2">ASSIGNEE</div>
            <div className="p-2">COMPLIANCE</div>
          </div>
          {requirements.map((r, i) => (
            <div
              key={r.id}
              className={`grid grid-cols-[80px_130px_1fr_180px_130px_120px] border-b-2 border-ink ${
                i % 2 ? "bg-bone" : "bg-paper"
              } ${r.compliance === "NOT_ADDRESSED" ? "ring-2 ring-inset ring-blood" : ""}`}
            >
              <div className="border-r-2 border-ink p-3 font-mono text-[11px] font-bold">{r.ref}</div>
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
          <Panel title="GAP ANALYSIS" code="GAP" accent="blood">
            <ul className="flex flex-col gap-2">
              {requirements
                .filter((r) => r.compliance === "NOT_ADDRESSED" || r.compliance === "PARTIALLY")
                .map((r) => (
                  <li key={r.id} className="border-2 border-ink bg-paper p-2 font-mono text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="font-bold">{r.ref}</span>
                      <StatusPill value={r.compliance} />
                    </div>
                    <div className="mt-1 text-[11px] leading-snug">{r.text.slice(0, 120)}…</div>
                    <div className="mt-1 text-[9px] uppercase text-ink/60">{r.section}</div>
                  </li>
                ))}
            </ul>
          </Panel>

          <Panel title="VOLUME HEALTH" code="VOL" accent="hazard">
            <div className="flex flex-col gap-3 font-mono text-[11px]">
              <div>
                <div className="flex items-center justify-between">
                  <span>VOL I · TECHNICAL</span>
                  <span className="font-bold">78%</span>
                </div>
                <BarMeter value={78} color="signal" />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span>VOL II · MGMT</span>
                  <span className="font-bold">84%</span>
                </div>
                <BarMeter value={84} color="signal" />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span>VOL III · PAST PERF</span>
                  <span className="font-bold">62%</span>
                </div>
                <BarMeter value={62} color="hazard" />
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <span>VOL IV · PRICE</span>
                  <span className="font-bold">0%</span>
                </div>
                <BarMeter value={2} color="blood" />
              </div>
            </div>
          </Panel>

          <Panel title="FORMAT GATES" code="FMT" accent="ink">
            <ul className="flex flex-col gap-1 font-mono text-[11px]">
              {[
                { k: "PAGE LIMIT · 200", v: "184 · OK", ok: true },
                { k: "FONT · TNR 12", v: "PASS", ok: true },
                { k: "MARGINS · 1.0in", v: "PASS", ok: true },
                { k: "TABLE FONT · ≥10", v: "WARN · 9pt in T3-1", ok: false },
                { k: "IMAGES · 300dpi", v: "PASS", ok: true },
              ].map((g) => (
                <li
                  key={g.k}
                  className="flex items-center justify-between border-b border-ink/20 py-1"
                >
                  <span className="uppercase">{g.k}</span>
                  <span className={`brut-chip ${g.ok ? "bg-signal" : "bg-hazard"}`}>{g.v}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>
    </>
  );
}
