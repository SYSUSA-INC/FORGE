import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { OrgSettingsForm } from "@/components/settings/OrgSettingsForm";

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Settings — Organization"
        title="Settings"
        subtitle="Manage your organization profile, SAM.gov registration, contracting vehicles, past performance, and AI engine. Changes persist locally until the backend is wired."
      />

      <OrgSettingsForm />

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="AI engine" eyebrow="Generation + retrieval" accent="violet">
          <div className="grid grid-cols-2 gap-3">
            <ReadField label="Primary model" value="Claude Sonnet 4.6" />
            <ReadField label="High-stakes model" value="Claude Opus 4.7" />
            <ReadField label="Embeddings" value="voyage-3-large" />
            <ReadField label="Retrieval k" value="12" />
            <ReadField label="Temperature" value="0.3" />
            <ReadField label="Max tokens" value="8,192" />
            <ReadField label="Audit mode" value="Strict · prompt hash logged" />
            <ReadField label="Rate limit" value="480 RPM" />
          </div>
        </Panel>

        <Panel title="Integrations" eyebrow="External data" accent="gold">
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
                className="grid grid-cols-[1fr_auto_120px] items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-2 font-mono text-[11px]"
              >
                <span>{x.n}</span>
                <span
                  className={`brut-chip ${
                    x.ok ? "border-emerald/40 bg-emerald/10 text-emerald" : "border-rose/40 bg-rose/10 text-rose"
                  }`}
                >
                  {x.s}
                </span>
                <button className="aur-btn w-full px-2 py-1 text-[10px]">
                  {x.ok ? "Manage" : "Connect"}
                </button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Users & roles" eyebrow="Team" accent="emerald">
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
                className="grid grid-cols-[32px_1fr_160px_80px] items-center gap-2 border-b border-white/10 py-1.5"
              >
                <div className="grid h-7 w-7 place-items-center rounded-md border border-white/15 bg-white/[0.04] text-[10px] font-bold uppercase text-text">
                  {n
                    .split(" ")
                    .map((x) => x[0])
                    .join("")}
                </div>
                <span>{n}</span>
                <span className="brut-chip">{r}</span>
                <button className="aur-btn px-2 py-1 text-[10px]">Edit</button>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}

function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="aur-label">{label}</div>
      <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 font-mono text-sm text-text">
        {value}
      </div>
    </div>
  );
}
