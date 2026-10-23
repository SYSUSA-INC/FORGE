import Link from "next/link";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { resolvePolicy } from "@/lib/upload-policy";
import { GsaPasteClient } from "./GsaPasteClient";

export const dynamic = "force-dynamic";
// BL-STAB-2d — room for filing up to 20 attachments and starting their parses from this page.
export const maxDuration = 300;

export default async function GsaImportPage() {
  await requireAuth();
  await requireCurrentOrg();
  // The per-file limit as this deployment sets it (UPLOAD_MAX_FILE_MB), handed to the browser's own check.
  const maxBytes = resolvePolicy("document", process.env).maxBytes;

  return (
    <>
      <PageHeader
        eyebrow="Capture · GSA"
        title="Paste GSA email"
        subtitle="Forwarded a GSA opportunity notification? Paste the email body and FORGE extracts the structured fields. Drop the RFP/RFQ attachments alongside and they'll be linked to the new opportunity automatically."
        actions={
          <Link href="/opportunities/import" className="aur-link">
            ← Back to import
          </Link>
        }
      />
      <GsaPasteClient maxBytes={maxBytes} />
    </>
  );
}
