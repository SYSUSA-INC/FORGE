import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { PreviewBanner } from "@/components/ui/PreviewBanner";

export default function NewSolicitationPage() {
  return (
    <>
      <PageHeader
        eyebrow="Solicitations — Intake"
        title="New solicitation"
        subtitle="Upload a raw RFP, RFI, RFQ, or Sources Sought notice. FORGE parses Section L / M, extracts requirements, and builds the compliance matrix."
      />
      <PreviewBanner
        title="Preview · not yet wired"
        message="This page is the design for solicitation intake. The Select Files button, dropzone, and pipeline steps are scaffolding — uploading does not currently parse or extract anything. To start a real proposal today, create an opportunity (manually or by importing from SAM.gov), then build a proposal against it."
        roadmap="Real intake (PDF/DOCX upload → OCR → Section L/M extraction → requirement mining → compliance matrix auto-assembly) needs Browserless / file storage / a parsing pipeline. It's slated after the v1 MVP authoring chapter ships."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href="/opportunities/new" className="aur-btn aur-btn-primary">
          + Create opportunity manually
        </Link>
        <Link href="/opportunities/import" className="aur-btn">
          Import from SAM.gov
        </Link>
        <Link href="/proposals/new" className="aur-btn aur-btn-ghost">
          New proposal
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <Panel title="Upload">
          <div className="relative grid place-items-center border-4 border-dashed border-ink bg-bone p-12 text-center">
            <div className="font-display text-3xl font-bold">Drop files here</div>
            <div className="mt-2 font-mono text-[11px] uppercase tracking-widest text-ink/60">
              PDF · DOCX · XLSX · ZIP · max 500 MB
            </div>
            <button className="brut-btn-primary mt-4">Select files</button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field label="Solicitation number" placeholder="N00024-25-R-0094" />
            <Field label="Agency" placeholder="Dept. of Navy / NAVSEA" />
            <Field label="Type" placeholder="RFP" />
            <Field label="NAICS" placeholder="541512" />
            <Field label="Set-aside" placeholder="SB / 8(a) / WOSB / —" />
            <Field label="Due date" placeholder="2026-04-29 14:00 EST" />
          </div>
        </Panel>

        <Panel title="Pipeline">
          <ol className="relative ml-2 flex flex-col gap-5 border-l-4 border-ink pl-4 font-mono text-[11px]">
            {[
              ["Upload", "Raw files accepted"],
              ["OCR & parse", "pdf-parse · Tesseract"],
              ["Section L / M", "Claude extract"],
              ["Requirement mining", "shall / should / may"],
              ["Evaluation criteria", "Factor / subfactor"],
              ["Embedding", "pgvector index"],
              ["Compliance matrix", "Auto-assembled"],
            ].map((step, i) => (
              <li key={step[0]} className="relative">
                <span
                  className={`absolute -left-[26px] top-0.5 h-4 w-4 border-2 border-ink ${
                    i < 2 ? "bg-ink" : i === 2 ? "bg-hazard" : "bg-paper"
                  }`}
                />
                <div className="flex items-center justify-between">
                  <div className="font-display text-sm font-bold">{step[0]}</div>
                  <span className="font-mono text-[9px] uppercase text-ink/50">
                    0{i + 1}
                  </span>
                </div>
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
