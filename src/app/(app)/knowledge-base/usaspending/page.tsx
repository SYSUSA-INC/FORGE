import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { UsaspendingImportClient } from "./UsaspendingImportClient";

export const dynamic = "force-dynamic";

export default async function UsaspendingImportPage() {
  await requireAuth();
  await requireCurrentOrg();

  return (
    <>
      <PageHeader
        eyebrow="Knowledge · Import past performance"
        title="USAspending.gov"
        subtitle="Pull federal contracts you've won (or partnered on) directly from USAspending.gov and import them as past-performance entries. The Brain uses these as grounding when drafting past-performance volumes."
        actions={
          <Link href="/knowledge-base" className="aur-btn aur-btn-ghost">
            ← Knowledge base
          </Link>
        }
      />
      <UsaspendingImportClient />
    </>
  );
}
