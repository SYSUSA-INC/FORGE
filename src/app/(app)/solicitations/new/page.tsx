import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { formatLimit, resolvePolicy } from "@/lib/upload-policy";
import { UploadSolicitationForm } from "./UploadSolicitationForm";

export const dynamic = "force-dynamic";
// BL-STAB-2c — room for filing an upload and starting its parse from this page.
export const maxDuration = 300;

export default async function NewSolicitationPage() {
  await requireAuth();
  await requireCurrentOrg();
  // The per-file limit as this deployment sets it (UPLOAD_MAX_FILE_MB), handed to the browser's own check.
  const maxBytes = resolvePolicy("document", process.env).maxBytes;

  return (
    <>
      <PageHeader
        eyebrow="Solicitations · Intake"
        title="New solicitation"
        subtitle={`Upload an RFP / RFI / RFQ / Sources Sought (PDF, Word, Excel, PowerPoint, text or image, up to ${formatLimit(maxBytes)}). FORGE reads the whole document for its requirements, Sections L and M and key dates, then stamps the result onto a record you can convert into an opportunity.`}
        actions={
          <Link href="/solicitations" className="aur-btn aur-btn-ghost">
            All solicitations
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
        <UploadSolicitationForm maxBytes={maxBytes} />

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
                  The file goes from your browser straight to secure
                  storage, is checked, and is filed as a solicitation; the
                  parse runs in the background.
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
                  The text layer is extracted locally. Scanned-image PDFs
                  and images fall through to vision OCR automatically.
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
                  The whole document is read, a part at a time, for every
                  shall / should / may requirement and where it is stated;
                  Sections L and M are structured; agency / office / NAICS /
                  set-aside and key dates are captured.
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
              Files up to {formatLimit(maxBytes)} upload. Very large ones are
              kept but read only up to a size per type (PDF 150 MB, Word
              100 MB, Excel 40 MB); FORGE says so and asks you to split them.
              Without <code>ANTHROPIC_API_KEY</code> on Vercel the upload
              succeeds but the AI extraction stays empty.
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}
