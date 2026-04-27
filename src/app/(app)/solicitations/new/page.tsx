import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { UploadSolicitationForm } from "./UploadSolicitationForm";

export const dynamic = "force-dynamic";

export default async function NewSolicitationPage() {
  await requireAuth();
  await requireCurrentOrg();

  return (
    <>
      <PageHeader
        eyebrow="Solicitations · Intake"
        title="New solicitation"
        subtitle="Upload an RFP / RFI / RFQ / Sources Sought PDF. FORGE extracts the text, asks the AI gateway to pull Section L summary, Section M summary, and the top shall / should / may statements, then stamps the result onto a record you can convert into an opportunity."
        actions={
          <Link href="/solicitations" className="aur-btn aur-btn-ghost">
            All solicitations
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <UploadSolicitationForm />

        <Panel title="What happens next" eyebrow="Pipeline">
          <ol className="flex flex-col gap-3 font-body text-[13px] text-muted">
            <li className="flex gap-3">
              <span className="font-mono text-[10px] uppercase tracking-widest text-teal">
                01
              </span>
              <div>
                <div className="font-display text-[13px] font-semibold text-text">
                  Upload
                </div>
                <div className="mt-0.5">
                  PDF stored via the configured storage provider (memory in
                  dev, R2 when wired up).
                </div>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="font-mono text-[10px] uppercase tracking-widest text-teal">
                02
              </span>
              <div>
                <div className="font-display text-[13px] font-semibold text-text">
                  Text extraction
                </div>
                <div className="mt-0.5">
                  pdf-parse pulls the text layer. Scanned-image-only PDFs
                  fail with an explicit message — OCR comes next.
                </div>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="font-mono text-[10px] uppercase tracking-widest text-teal">
                03
              </span>
              <div>
                <div className="font-display text-[13px] font-semibold text-text">
                  AI extraction
                </div>
                <div className="mt-0.5">
                  AI gateway returns Section L summary, Section M summary,
                  agency / office / NAICS / set-aside / due date, plus the
                  top 25 shall/should/may statements with section refs.
                </div>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="font-mono text-[10px] uppercase tracking-widest text-teal">
                04
              </span>
              <div>
                <div className="font-display text-[13px] font-semibold text-text">
                  Convert to opportunity
                </div>
                <div className="mt-0.5">
                  One click stamps the metadata into a real Opportunity
                  with the right title / agency / NAICS / due date so you
                  can run a qualification scorecard against it.
                </div>
              </div>
            </li>
          </ol>
          <div className="mt-4 rounded-md border border-amber-400/40 bg-amber-400/[0.06] p-3">
            <div className="font-mono text-[10px] uppercase tracking-widest text-amber-300">
              Heads-up
            </div>
            <p className="mt-1 font-body text-[12px] leading-relaxed text-muted">
              25 MB cap per PDF in v1. Set <code>ANTHROPIC_API_KEY</code>{" "}
              on Vercel to enable AI extraction (otherwise the upload
              succeeds but the extracted summaries stay empty).
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}
