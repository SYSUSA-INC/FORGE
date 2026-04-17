import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="SET // ORGANIZATION CONFIG"
        title="SETTINGS"
        subtitle="Organization identity, integrations, users, and AI engine configuration."
        actions={<button className="brut-btn-hazard">SAVE CHANGES</button>}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="ORGANIZATION" code="ORG">
          <div className="grid grid-cols-2 gap-3">
            <Field label="LEGAL NAME" value="SYSUSA INC." />
            <Field label="DUNS / UEI" value="UEI: J9K8H7L5M2N3" />
            <Field label="CAGE CODE" value="7M0X1" />
            <Field label="SAM STATUS" value="ACTIVE" accent="bg-signal" />
            <Field label="NAICS" value="541512 · 541511 · 541330" />
            <Field label="SET ASIDE" value="SB · 8(a) · WOSB" />
            <Field label="CLEARANCE" value="TOP SECRET · FACILITY" />
            <Field label="DCAA STATUS" value="APPROVED 2025-07" accent="bg-signal" />
          </div>
        </Panel>

        <Panel title="AI ENGINE" code="AI" accent="signal">
          <div className="flex flex-col gap-3">
            <Field label="PRIMARY MODEL" value="Claude Sonnet 4.6" />
            <Field label="HIGH-STAKES MODEL" value="Claude Opus 4.7" accent="bg-hazard" />
            <Field label="EMBEDDINGS" value="voyage-3-large" />
            <Field label="RETRIEVAL K" value="12" />
            <Field label="TEMPERATURE" value="0.3" />
            <Field label="MAX TOKENS" value="8,192" />
            <Field label="AUDIT MODE" value="STRICT · PROMPT HASH LOGGED" accent="bg-ink text-paper" />
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
              ["J. Calder", "CAPTURE_MANAGER"],
              ["A. Okafor", "PROPOSAL_MANAGER"],
              ["K. Park", "AUTHOR"],
              ["R. Singh", "AUTHOR"],
              ["M. Reyes", "REVIEWER"],
              ["A. Brahms", "REVIEWER"],
              ["S. Doran", "REVIEWER"],
              ["L. Vasquez", "PRICING_ANALYST"],
            ].map(([n, r]) => (
              <li
                key={n}
                className="grid grid-cols-[1fr_160px_80px] items-center gap-2 border-b border-ink/20 py-1"
              >
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
