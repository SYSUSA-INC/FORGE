import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";

export default function NewSolicitationPage() {
  return (
    <>
      <PageHeader
        eyebrow="SOL // INTAKE · OCR · EXTRACT"
        title="INTAKE"
        subtitle="Upload the raw RFP/RFI/RFQ/Sources Sought. FORGE parses Section L/M, extracts requirements, and builds the compliance matrix."
        barcode="SOL-NEW-001"
        stamp={{ label: "AWAITING FILES", tone: "hazard" }}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <Panel title="UPLOAD ZONE" code="FX" accent="hazard">
          <div className="brut-diagonal-hazard mb-4 h-10 border-2 border-ink" />
          <div className="relative grid place-items-center border-4 border-dashed border-ink bg-bone p-12 text-center">
            {/* Crosshatch texture */}
            <div className="brut-crosshatch pointer-events-none absolute inset-0 opacity-50" />
            <div className="relative">
              <div className="brut-stencil text-6xl uppercase leading-none">DROP</div>
              <div className="brut-stencil text-6xl uppercase leading-none text-ink/60">ZONE</div>
              <div className="mt-3 font-mono text-[11px] uppercase tracking-widest text-ink/70">
                PDF · DOCX · XLSX · ZIP · max 500MB
              </div>
              <button className="brut-btn-primary mt-4">SELECT FILES</button>
            </div>
            {/* Corner marks */}
            <span className="absolute left-2 top-2 h-4 w-4 border-l-4 border-t-4 border-ink" />
            <span className="absolute right-2 top-2 h-4 w-4 border-r-4 border-t-4 border-ink" />
            <span className="absolute bottom-2 left-2 h-4 w-4 border-b-4 border-l-4 border-ink" />
            <span className="absolute bottom-2 right-2 h-4 w-4 border-b-4 border-r-4 border-ink" />
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
                    i < 2 ? "bg-ink" : i === 2 ? "bg-hazard animate-pulse__" : "bg-paper"
                  }`}
                />
                <div className="flex items-center justify-between">
                  <div className="font-display text-sm font-bold uppercase">{step[0]}</div>
                  <span className="font-mono text-[9px] uppercase text-ink/50">
                    0{i + 1}
                  </span>
                </div>
                <div className="text-[10px] uppercase text-ink/60">{step[1]}</div>
              </li>
            ))}
          </ol>

          <div className="mt-6 border-2 border-ink bg-ink p-3 font-mono text-[10px] uppercase tracking-widest text-paper">
            <div className="mb-1 flex items-center justify-between">
              <span>WORKER QUEUE</span>
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 animate-blink bg-signal" /> OK
              </span>
            </div>
            <div className="flex items-end gap-[2px]">
              {[2, 4, 3, 6, 5, 7, 4, 6, 8, 5, 7, 9].map((v, i) => (
                <div key={i} className="w-2 bg-paper" style={{ height: v * 4 }} />
              ))}
            </div>
          </div>
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
