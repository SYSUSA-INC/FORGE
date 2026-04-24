import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { CompanyForm } from "../CompanyForm";

export const dynamic = "force-dynamic";

export default async function NewCompanyPage() {
  await requireAuth();
  await requireCurrentOrg();

  return (
    <>
      <PageHeader
        eyebrow="Intel"
        title="Add company"
        subtitle="Enter fields manually or use Search SAM.gov to auto-fill from a UEI."
        actions={
          <Link href="/companies" className="aur-btn aur-btn-ghost">
            Cancel
          </Link>
        }
      />
      <Panel title="Company details">
        <CompanyForm mode="create" />
      </Panel>
    </>
  );
}
