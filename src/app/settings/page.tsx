import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Settings — Organization"
        title="Settings"
        subtitle="Organization identity, integrations, users, and AI engine configuration."
        actions={<button className="brut-btn-hazard">Save changes</button>}
      />

      {/* Org identity banner */}
      <section className="mb-6 border-2 border-ink bg-ink p-6 text-paper shadow-brut">
        <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-paper/60">
          Registered entity
        </div>
        <div className="mt-1 font-display text-4xl font-bold tracking-tight text-paper">
          SYSUSA Inc.
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tag k="UEI" v="J9K8H7L5M2N3" />
          <Tag k="CAGE" v="7M0X1" />
          <Tag k="DCAA" v="Approved" tone="signal" />
          <Tag k="SAM" v="Active · 2026-08-14" tone="hazard" />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Organization" code="ORG">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Legal name" value="SYSUSA Inc." />
            <Field label="DUNS / UEI" value="UEI: J9K8H7L5M2N3" />
            <Field label="CAGE code" value="7M0X1" />
            <Field label="SAM status" value="Active" accent="bg-signal" />
            <Field label="NAICS" value="541512 · 541511 · 541330" />
            <Field label="Set-aside" value="SB · 8(a) · WOSB" />
            <Field label="Clearance" value="Top Secret · Facility" accent="bg-ink text-paper" />
            <Field label="DCAA status" value="Approved · 2025-07" accent="bg-signal" />
          </div>
        </Panel>

        <Panel title="AI engine" code="AI">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Primary model" value="Claude Sonnet 4.6" />
            <Field label="High-stakes model" value="Claude Opus 4.7" accent="bg-hazard" />
            <Field label="Embeddings" value="voyage-3-large" />
            <Field label="Retrieval k" value="12" />
            <Field label="Temperature" value="0.3" />
            <Field label="Max tokens" value="8,192" />
            <Field
              label="Audit mode"
              value="Strict · prompt hash logged"
              accent="bg-ink text-paper"
            />
            <Field label="Rate limit" value="480 RPM" />
          </div>
        </Panel>

        <Panel title="Integrations" code="INT">
          <ul className="flex flex-col gap-2">
            {[
              { n: "SAM.gov", s: "Connected", ok: true },
              { n: "FPDS", s: "Connected", ok: true },
              { n: "CPARS (read)", s: "Connected", ok: true },
              { n: "GovWin IQ", s: "Disconnected", ok: false },
              { n: "SharePoint O365", s: "Connected", ok: true },
              { n: "Defense Connect Online", s: "Disconnected", ok: false },
            ].map((x) => (
              <li
                key={x.n}
                className="grid grid-cols-[1fr_auto_120px] items-center gap-2 border-2 border-ink bg-paper p-2 font-mono text-[11px]"
              >
                <span>{x.n}</span>
                <span className={`brut-chip ${x.ok ? "bg-signal" : "bg-blood text-paper"}`}>
                  {x.s}
                </span>
                <button className="brut-btn w-full px-2 py-1 text-[10px]">
                  {x.ok ? "Manage" : "Connect"}
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Users & roles" code="USR">
          <ul className="flex flex-col gap-1 font-mono text-[11px]">
            {[
              ["J. Calder", "Capture manager"],
              ["A. Okafor", "Proposal manager"],
              ["K. Park", "Author"],
              ["R. Singh", "Author"],
              ["M. Reyes", "Reviewer"],
              ["A. Brahms", "Reviewer"],
              ["S. Doran", "Reviewer"],
              ["L. Vasquez", "Pricing analyst"],
            ].map(([n, r]) => (
              <li
                key={n}
                className="grid grid-cols-[32px_1fr_160px_80px] items-center gap-2 border-b border-ink/20 py-1"
              >
                <div className="grid h-7 w-7 place-items-center border-2 border-ink bg-ink text-[10px] font-bold uppercase text-paper">
                  {n
                    .split(" ")
                    .map((x) => x[0])
                    .join("")}
                </div>
                <span>{n}</span>
                <span className="brut-chip bg-paper">{r}</span>
                <button className="brut-btn px-2 py-1 text-[10px]">Edit</button>
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
        className={`border-2 border-ink px-3 py-2 font-mono text-sm ${accent ?? "bg-paper"}`}
      >
        {value}
      </div>
    </div>
  );
}

function Tag({ k, v, tone }: { k: string; v: string; tone?: "hazard" | "signal" }) {
  const bg =
    tone === "hazard"
      ? "bg-hazard text-ink"
      : tone === "signal"
        ? "bg-signal text-ink"
        : "bg-paper text-ink";
  return (
    <div className={`border-2 border-ink p-2 ${bg}`}>
      <div className="font-mono text-[9px] uppercase tracking-widest opacity-70">{k}</div>
      <div className="font-mono text-sm font-bold">{v}</div>
    </div>
  );
}
