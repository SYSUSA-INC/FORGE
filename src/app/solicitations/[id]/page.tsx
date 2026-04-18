import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { StatusPill } from "@/components/ui/StatusPill";
import { BarMeter } from "@/components/ui/BarMeter";
import { Radar } from "@/components/ui/Radar";
import { Perforation } from "@/components/ui/Perforation";
import { requirements, solicitations } from "@/lib/mock";

export default function SolicitationDetail({ params }: { params: { id: string } }) {
  const sol = solicitations.find((s) => s.id === params.id) ?? solicitations[0];
  if (!sol) notFound();

  const mandatory = requirements.filter((r) => r.category === "MANDATORY").length;
  const desired = requirements.filter((r) => r.category === "DESIRED").length;
  const info = requirements.filter((r) => r.category === "INFORMATIONAL").length;

  return (
    <>
      <PageHeader
        eyebrow={`SOL // ${sol.number} · ${sol.type}`}
        title={sol.id.replace("SOL-", "SOL·")}
        subtitle={`${sol.title} — ${sol.agency} · NAICS ${sol.naics} · ${sol.setAside} · CT ${sol.contractType}`}
        barcode={sol.number}
        stamp={{
          label:
            sol.bidDecision === "BID"
              ? "BID APPROVED"
              : sol.bidDecision === "NO_BID"
                ? "NO BID"
                : "UNDER REVIEW",
          tone: sol.bidDecision === "BID" ? "signal" : sol.bidDecision === "NO_BID" ? "blood" : "hazard",
        }}
        actions={
          <>
            <StatusPill value={sol.bidDecision} />
            <button className="brut-btn">UPLOAD AMENDMENT</button>
            <Link href={`/proposals/new?sol=${sol.id}`} className="brut-btn-hazard">
              → START PROPOSAL
            </Link>
          </>
        }
        meta={[
          { label: "DUE", value: sol.dueAt.split(" ")[0], accent: "blood" },
          { label: "CEILING", value: sol.value, accent: "signal" },
          { label: "REQUIREMENTS", value: String(sol.requirementCount) },
          { label: "AMENDMENTS", value: String(sol.amendments).padStart(2, "0"), accent: "hazard" },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-4">
          <Panel title="SECTION L · INSTRUCTIONS TO OFFERORS" code="L" accent="ink">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Bucket label="MANDATORY" n={mandatory} tone="blood" />
              <Bucket label="DESIRED" n={desired} tone="hazard" />
              <Bucket label="INFORMATIONAL" n={info} tone="bone" />
              <Bucket label="UNPARSED" n={6} tone="paper" />
            </div>

            <div className="relative mt-4 border-2 border-ink bg-bone p-4 font-mono text-xs leading-relaxed">
              <span className="absolute -top-3 left-3 bg-ink px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest text-paper">
                SOURCE EXCERPT · L.5.2.1
              </span>
              <p className="mt-2">
                &ldquo;The Offeror{" "}
                <mark className="bg-hazard px-0.5 font-bold">shall</mark> describe its approach to
                integrating AI/ML models with shipboard C5ISR systems, including{" "}
                <mark className="bg-hazard px-0.5 font-bold">latency targets</mark>, fail-safe modes,
                and
                <mark className="bg-hazard px-0.5 font-bold"> human-on-the-loop</mark> design consistent
                with DoD Directive 3000.09 and Navy Sea Systems Command policy.&rdquo;
              </p>
            </div>
          </Panel>

          <Panel title="SECTION M · EVALUATION CRITERIA" code="M" accent="hazard">
            <ul className="flex flex-col divide-y-2 divide-ink border-2 border-ink">
              {[
                { f: "FACTOR 1", t: "Technical Approach", w: 40 },
                { f: "FACTOR 2", t: "Management Approach", w: 25 },
                { f: "FACTOR 3", t: "Past Performance", w: 20 },
                { f: "FACTOR 4", t: "Price", w: 15 },
              ].map((f) => (
                <li
                  key={f.f}
                  className="grid grid-cols-[100px_1fr_140px_60px] items-center gap-3 p-3"
                >
                  <span className="brut-pill bg-ink text-paper">{f.f}</span>
                  <div className="font-display text-lg font-bold uppercase">{f.t}</div>
                  <BarMeter value={f.w} color="hazard" label="WEIGHT" right={`${f.w}%`} />
                  <div className="brut-stencil text-right text-3xl leading-none">{f.w}</div>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="REQUIREMENT MATRIX · PREVIEW" code="REQ" dense>
            <div className="grid grid-cols-[80px_140px_1fr_160px_140px] border-b-2 border-ink bg-ink font-mono text-[10px] uppercase tracking-[0.2em] text-paper">
              <div className="border-r border-paper/20 p-2">REF</div>
              <div className="border-r border-paper/20 p-2">CATEGORY</div>
              <div className="border-r border-paper/20 p-2">REQUIREMENT</div>
              <div className="border-r border-paper/20 p-2">SECTION</div>
              <div className="p-2">COMPLIANCE</div>
            </div>
            {requirements.slice(0, 6).map((r, i) => (
              <div
                key={r.id}
                className={`grid grid-cols-[80px_140px_1fr_160px_140px] border-b-2 border-ink ${
                  i % 2 ? "bg-bone" : "bg-paper"
                }`}
              >
                <div className="border-r-2 border-ink p-3 font-mono text-[11px] font-bold">
                  {r.ref}
                </div>
                <div className="border-r-2 border-ink p-3">
                  <StatusPill value={r.category} />
                </div>
                <div className="border-r-2 border-ink p-3 text-sm leading-snug">{r.text}</div>
                <div className="border-r-2 border-ink p-3 font-mono text-[11px]">{r.section}</div>
                <div className="p-3">
                  <StatusPill value={r.compliance} />
                </div>
              </div>
            ))}
          </Panel>
        </div>

        <div className="flex flex-col gap-4">
          <Panel title="FILE INTAKE" code="FX">
            <div className="brut-diagonal-hazard mb-3 h-10 w-full border-2 border-ink" />
            <ul className="flex flex-col gap-2">
              {[
                { n: "RFP_BASE.pdf", t: "Base RFP", s: "4.2 MB", ok: true },
                { n: "AMEND_0001.pdf", t: "Amendment 01", s: "0.9 MB", ok: true },
                { n: "AMEND_0002.pdf", t: "Amendment 02", s: "1.4 MB", ok: true },
                { n: "AMEND_0003.pdf", t: "Amendment 03", s: "0.7 MB", ok: true },
                { n: "AMEND_0004.pdf", t: "Amendment 04", s: "1.1 MB", ok: false },
                { n: "Q_AND_A.xlsx", t: "Q&A", s: "48 KB", ok: true },
              ].map((f) => (
                <li
                  key={f.n}
                  className="grid grid-cols-[28px_1fr_auto] items-center gap-3 border-2 border-ink bg-paper px-3 py-2"
                >
                  <div className="grid h-6 w-6 place-items-center border-2 border-ink bg-ink font-mono text-[9px] font-bold text-paper">
                    {f.n.endsWith(".pdf") ? "PDF" : f.n.endsWith(".xlsx") ? "XLS" : "DOC"}
                  </div>
                  <div>
                    <div className="font-mono text-[11px] font-bold uppercase">{f.t}</div>
                    <div className="font-mono text-[10px] text-ink/60">
                      {f.n} · {f.s}
                    </div>
                  </div>
                  <span className={`brut-chip ${f.ok ? "bg-signal" : "bg-hazard"}`}>
                    {f.ok ? "PARSED" : "QUEUED"}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="BID DECISION" code="GO/NO-GO" accent="blood">
            <div className="grid grid-cols-3 gap-2">
              <button className="brut-btn bg-signal text-ink">BID</button>
              <button className="brut-btn bg-hazard">REVIEW</button>
              <button className="brut-btn bg-blood text-paper">NO-BID</button>
            </div>

            <Perforation className="my-4" />

            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-widest text-ink/60">
                FIT PROFILE
              </span>
              <span className="font-mono text-[10px] uppercase tracking-widest text-ink/60">
                P(WIN) {sol.pWin}%
              </span>
            </div>
            <div className="h-48">
              <Radar
                data={[
                  { label: "STRAT", value: 82 },
                  { label: "TECH", value: 68 },
                  { label: "PP", value: 74 },
                  { label: "PRICE", value: 54 },
                  { label: "RISK", value: 32 },
                ]}
              />
            </div>
          </Panel>

          <Panel title="TIMELINE" code="TM" accent="cobalt">
            <ol className="relative ml-2 flex flex-col gap-4 border-l-4 border-ink pl-4">
              {[
                { d: "MAR 18", t: "Posted to SAM.gov", done: true },
                { d: "MAR 22", t: "Amendment 01 · QA set A", done: true },
                { d: "APR 02", t: "Industry Day (virtual)", done: true },
                { d: "APR 10", t: "Q&A Deadline", done: true },
                { d: "APR 18", t: "Amendment 04 · schedule change", done: false },
                { d: "APR 29", t: "PROPOSAL DUE · 14:00 EST", done: false, hot: true },
              ].map((e) => (
                <li key={e.d} className="relative">
                  <span
                    className={`absolute -left-[26px] top-1 h-4 w-4 border-2 border-ink ${
                      e.done ? "bg-ink" : e.hot ? "bg-blood animate-pulse__" : "bg-paper"
                    }`}
                  />
                  <div className="font-mono text-[10px] uppercase tracking-widest text-ink/60">
                    {e.d}
                  </div>
                  <div
                    className={`font-display text-sm font-bold ${e.hot ? "text-blood" : ""}`}
                  >
                    {e.t}
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}

function Bucket({
  label,
  n,
  tone,
}: {
  label: string;
  n: number;
  tone: "blood" | "hazard" | "bone" | "paper";
}) {
  const bg =
    tone === "blood"
      ? "bg-blood text-paper"
      : tone === "hazard"
        ? "bg-hazard text-ink"
        : tone === "bone"
          ? "bg-bone"
          : "bg-paper";
  return (
    <div className={`border-2 border-ink p-3 ${bg}`}>
      <div className="font-mono text-[10px] uppercase tracking-widest opacity-80">{label}</div>
      <div className="brut-stencil text-5xl leading-none">{n}</div>
      <div className="mt-1 font-mono text-[9px] uppercase tracking-widest opacity-60">REQS</div>
    </div>
  );
}
