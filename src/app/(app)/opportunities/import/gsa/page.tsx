import Link from "next/link";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { GsaPasteClient } from "./GsaPasteClient";

export const dynamic = "force-dynamic";

export default async function GsaImportPage() {
  await requireAuth();
  await requireCurrentOrg();

  return (
    <>
      <PageHeader
        eyebrow="Capture · GSA"
        title="Paste GSA email"
        subtitle="Forwarded a GSA opportunity notification? Paste the email body and FORGE extracts the structured fields. Drop the RFP/RFQ attachments alongside and they'll be linked to the new opportunity automatically."
        actions={
          <Link href="/opportunities/import" className="aur-btn aur-btn-ghost">
            ← Back to import
          </Link>
        }
      />
      <GsaPasteClient />
    </>
  );
}
