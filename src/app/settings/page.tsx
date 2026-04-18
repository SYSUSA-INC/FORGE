import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { Barcode } from "@/components/ui/Barcode";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="SET // ORGANIZATION CONFIG"
        title="CONFIG"
        subtitle="Organization identity, integrations, users, and AI engine configuration."
        barcode="ORG-SYSUSA-001"
        stamp={{ label: "SAM ACTIVE", tone: "signal" }}
        actions={<button className="brut-btn-hazard">SAVE CHANGES</button>}
      />

      {/* Org identity banner */}
      <section className="mb-6 overflow-hidden border-2 border-ink bg-ink shadow-brut-xl">
        <div className="grid grid-cols-1 gap-4 p-6 md:grid-cols-[1fr_auto] md:items-end">
          <div className="text-paper">
            <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-paper/60">
              REGISTERED ENTITY
            </div>
            <div className="brut-stencil mt-1 text-5xl leading-none tracking-[-0.03em] text-paper">
              SYSUSA INC.
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tag k="UEI" v="J9K8H7L5M2N3" />
              <Tag k="CAGE" v="7M0X1" />
              <Tag k="DCAA" v="APPROVED" tone="signal" />
              <Tag k="SAM" v="ACTIVE 2026-08-14" tone="hazard" />
            </div>
          </div>
          <div className="self-start text-paper">
            <Barcode value="UEI-J9K8H7L5M2N3" />
          </div>
        </div>
        <div className="brut-diagonal-hazard h-3" />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="ORGANIZATION" code="ORG">
          <div className="grid grid-cols-2 gap-3">
            <Field label="LEGAL NAME" value="SYSUSA INC." />
            <Field label="DUNS / UEI" value="UEI: J9K8H7L5M2N3" />
            <Field label="CAGE CODE" value="7M0X1" />
            <Field label="SAM STATUS" value="ACTIVE" accent="bg-signal" />
            <Field label="NAICS" value="541512 · 541511 · 541330" />
            <Field label="SET ASIDE" value="SB · 8(a) · WOSB" />
            <Field label="CLEARANCE" value="TOP SECRET · FACILITY" accent="bg-ink text-paper" />
            <Field label="DCAA STATUS" value="APPROVED 2025-07" accent="bg-signal" />
          </div>
        </Panel>

        <Panel title="AI ENGINE" code="AI" accent="signal">
          <div className="grid grid-cols-2 gap-3">
            <Field label="PRIMARY MODEL" value="Claude Sonnet 4.6" />
            <Field label="HIGH-STAKES MODEL" value="Claude Opus 4.7" accent="bg-hazard" />
            <Field label="EMBEDDINGS" value="voyage-3-large" />
            <Field label="RETRIEVAL K" value="12" />
            <Field label="TEMPERATURE" value="0.3" />
            <Field label="MAX TOKENS" value="8,192" />
            <Field
              label="AUDIT MODE"
              value="STRICT · PROMPT HASH LOGGED"
              accent="bg-ink text-paper"
            />
            <Field label="RATE LIMIT" value="480 RPM" />
          </div>
        </Panel>

        <Panel title="INTEGRATIONS" code="INT" accent="cobalt">
          <ul className="flex flex-col gap-2">
            {[
              { n: "SAM.GOV", s: "CONNECTED", ok: true },
              { n: "FPDS", s: "CONNECTED", ok: true },
              { n: "CPARS (read)", s: "CONNECTED", ok: true },
              { n: "GOVWIN IQ", s: "DISCONNECTED", ok: false },
              { n: "SHAREPOINT O365", s: "CONNECTED", ok: true },
              { n: "DEFENSE CONNECT ONLINE", s: "DISCONNECTED", ok: false },
            ].map((x) => (
              <li
                key={x.n}
                className="grid grid-cols-[1fr_auto_120px] items-center gap-2 border-2 border-ink bg-paper p-2 font-mono text-[11px]"
              >
                <span className="uppercase">{x.n}</span>
                <span
                  className={`brut-chip ${x.ok ? "bg-signal" : "bg-blood text-paper"}`}
                >
                  {x.s}
                </span>
                <button className="brut-btn w-full px-2 py-1 text-[10px]">
                  {x.ok ? "MANAGE" : "CONNECT"}
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="USERS & ROLES" code="USR" accent="hazard">
          <ul className="flex flex-col gap-1 font-mono text-[11px]">
            {[
              ["J. Calder", "CAPTURE_MANAGER", "bg-blood text-paper"],
              ["A. Okafor", "PROPOSAL_MANAGER", "bg-hazard"],
              ["K. Park", "AUTHOR", "bg-paper"],
              ["R. Singh", "AUTHOR", "bg-paper"],
              ["M. Reyes", "REVIEWER", "bg-cobalt text-paper"],
              ["A. Brahms", "REVIEWER", "bg-cobalt text-paper"],
              ["S. Doran", "REVIEWER", "bg-cobalt text-paper"],
              ["L. Vasquez", "PRICING_ANALYST", "bg-signal"],
            ].map(([n, r, color]) => (
              <li
                key={n}
                className="grid grid-cols-[32px_1fr_160px_80px] items-center gap-2 border-b border-ink/20 py-1"
              >
                <div
                  className={`grid h-7 w-7 place-items-center border-2 border-ink text-[10px] font-bold uppercase ${color}`}
                >
                  {n.split(" ").map((x) => x[0]).join("")}
                </div>
                <span className="uppercase">{n}</span>
                <span className="brut-chip bg-paper">{r}</span>
                <button className="brut-btn px-2 py-1 text-[10px]">EDIT</button>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}

function Field({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div className="brut-label">{label}</div>
      <div
        className={`border-2 border-ink px-3 py-2 font-mono text-sm ${
          accent ?? "bg-paper"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function Tag({ k, v, tone }: { k: string; v: string; tone?: "hazard" | "signal" }) {
  const bg =
    tone === "hazard" ? "bg-hazard text-ink" : tone === "signal" ? "bg-signal text-ink" : "bg-paper text-ink";
  return (
    <div className={`border-2 border-ink p-2 ${bg}`}>
      <div className="font-mono text-[9px] uppercase tracking-widest opacity-70">{k}</div>
      <div className="font-mono text-sm font-bold uppercase">{v}</div>
    </div>
  );
}
