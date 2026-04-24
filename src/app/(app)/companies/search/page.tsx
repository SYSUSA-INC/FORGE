import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { SearchClient } from "./SearchClient";

export const dynamic = "force-dynamic";

export default async function CompanySearchPage() {
  await requireAuth();
  await requireCurrentOrg();

  return (
    <>
      <PageHeader
        eyebrow="Intel"
        title="Search SAM.gov entities"
        subtitle="Look up registered companies by name, UEI, CAGE, or NAICS. Import them into your company list with a single click."
        actions={
          <Link href="/companies" className="aur-btn aur-btn-ghost">
            Back to companies
          </Link>
        }
      />
      <Panel title="Entity search">
        <SearchClient />
      </Panel>
    </>
  );
}
