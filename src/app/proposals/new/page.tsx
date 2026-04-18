import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { solicitations } from "@/lib/mock";

export default function NewProposalPage() {
  return (
    <>
      <PageHeader
        eyebrow="PRP // INITIATE PROPOSAL"
        title="NEW BID"
        subtitle="Spin up a proposal from a parsed solicitation. FORGE generates volume structure and assigns sections."
        barcode="PRP-NEW-0043"
        stamp={{ label: "DRAFT · PENDING", tone: "hazard" }}
        actions={
          <Link href="/proposals" className="brut-btn">
            CANCEL
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
        <Panel title="LINK SOLICITATION" code="SOL" accent="cobalt">
          <ul className="flex flex-col gap-2">
            {solicitations.slice(0, 4).map((s, i) => (
              <li
                key={s.id}
                className={`grid grid-cols-[24px_1fr_100px] items-center gap-2 border-2 border-ink p-3 ${
                  i === 0 ? "bg-hazard" : "bg-paper"
                }`}
              >
                <div
                  className={`grid h-5 w-5 place-items-center border-2 border-ink font-mono text-[11px] font-bold ${
                    i === 0 ? "bg-ink text-paper" : "bg-paper"
                  }`}
                >
                  {i === 0 ? "●" : ""}
                </div>
                <div>
                  <div className="font-display text-sm font-bold leading-tight">{s.title}</div>
                  <div className="font-mono text-[10px] uppercase text-ink/60">
                    {s.number} · {s.agency}
                  </div>
                </div>
                <button className="brut-btn-primary px-2 py-1 text-[10px]">SELECT</button>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="PROPOSAL CONFIG" code="CFG" accent="hazard">
          <div className="grid grid-cols-2 gap-3">
            <F label="PROPOSAL CODE" v="FRG-0043" />
            <F label="CAPTURE MANAGER" v="J. Calder" />
            <F label="PROPOSAL MANAGER" v="A. Okafor" />
            <F label="DUE DATE" v="2026-04-29 14:00 EST" />
            <F label="PAGE LIMIT" v="200" />
            <F label="VOLUMES" v="I/II/III/IV" />
          </div>
          <div className="mt-4 border-2 border-ink bg-bone p-3">
            <span className="brut-label">TEMPLATE</span>
            <div className="grid grid-cols-3 gap-2">
              {["DoD · SERVICES", "CIV · IT MOD", "SOURCES SOUGHT"].map((t, i) => (
                <button
                  key={t}
                  className={`brut-btn ${i === 0 ? "bg-ink text-paper" : ""}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <button className="brut-btn-hazard mt-4 w-full justify-between text-[14px]">
            <span>INITIATE PROPOSAL</span>
            <span>→</span>
          </button>
        </Panel>
      </div>
    </>
  );
}

function F({ label, v }: { label: string; v: string }) {
  return (
    <div>
      <div className="brut-label">{label}</div>
      <input className="brut-input" defaultValue={v} />
    </div>
  );
}
