import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { EbuyPasteClient } from "./EbuyPasteClient";

export const dynamic = "force-dynamic";

export default async function EbuyImportPage() {
  await requireAuth();
  await requireCurrentOrg();

  return (
    <>
      <PageHeader
        eyebrow="Capture · GSA"
        title="Paste from eBuy"
        subtitle="GSA eBuy doesn't expose a public API. Paste an RFQ body here and FORGE will extract the structured fields and create an opportunity."
      />
      <EbuyPasteClient />
    </>
  );
}
