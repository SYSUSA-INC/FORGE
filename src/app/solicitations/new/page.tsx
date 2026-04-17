import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";

export default function NewSolicitationPage() {
  return (
    <>
      <PageHeader
        eyebrow="SOL // INTAKE"
        title="NEW SOLICITATION"
        subtitle="Upload the raw RFP/RFI/RFQ/Sources Sought. FORGE parses Section L/M, extracts requirements, and builds the compliance matrix."
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <Panel title="UPLOAD ZONE" code="FX" accent="hazard">
          <div className="brut-diagonal-hazard mb-4 h-12 border-2 border-ink" />
          <div className="grid place-items-center border-4 border-dashed border-ink bg-bone p-12 text-center">
            <div className="font-display text-4xl font-bold uppercase">Drop Files</div>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-widest text-ink/60">
              PDF · DOCX · XLSX · ZIP · max 500MB
            </div>
            <button className="brut-btn-primary mt-4">SELECT FILES</button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field label="SOLICITATION NUMBER" placeholder="N00024-25-R-0094" />
            <Field label="AGENCY" placeholder="DEPT OF NAVY / NAVSEA" />
            <Field label="TYPE" placeholder="RFP" />
            <Field label="NAICS" placeholder="541512" />
            <Field label="SET-ASIDE" placeholder="SB / 8(a) / WOSB / —" />
            <Field label="DUE DATE" placeholder="2026-04-29 14:00 EST" />
          </div>
        </Panel>

        <Panel title="PIPELINE" code="PL" accent="cobalt">
          <ol className="relative ml-2 flex flex-col gap-5 border-l-4 border-ink pl-4 font-mono text-[11px]">
            {[
              ["UPLOAD", "Raw files accepted"],
              ["OCR & PARSE", "pdf-parse · Tesseract"],
              ["SECTION L/M", "Claude extract"],
              ["REQUIREMENT MINE", "shall/should/may"],
              ["EVAL CRITERIA", "Factor/Subfactor"],
              ["EMBEDDING", "pgvector index"],
              ["COMPLIANCE MATRIX", "auto-assembled"],
            ].map((step, i) => (
              <li key={step[0]} className="relative">
                <span
                  className={`absolute -left-[26px] top-0.5 h-4 w-4 border-2 border-ink ${
                    i < 2 ? "bg-ink" : "bg-paper"
                  }`}
                />
                <div className="font-display text-sm font-bold uppercase">{step[0]}</div>
                <div className="text-[10px] uppercase text-ink/60">{step[1]}</div>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </>
  );
}

function Field({ label, placeholder }: { label: string; placeholder: string }) {
  return (
    <div>
      <div className="brut-label">{label}</div>
      <input className="brut-input" placeholder={placeholder} />
    </div>
  );
}
