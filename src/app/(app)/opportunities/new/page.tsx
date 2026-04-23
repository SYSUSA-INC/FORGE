import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { listOpportunityOwners } from "../actions";
import { OpportunityForm } from "../OpportunityForm";

export const dynamic = "force-dynamic";

export default async function NewOpportunityPage() {
  const user = await requireAuth();
  await requireCurrentOrg();
  const owners = await listOpportunityOwners();

  return (
    <>
      <PageHeader
        eyebrow="Capture"
        title="New opportunity"
        subtitle="Add a lead, RFI, or pre-RFP notice you want to pursue."
        actions={
          <Link href="/opportunities" className="aur-btn aur-btn-ghost">
            Cancel
          </Link>
        }
      />
      <Panel title="Opportunity details">
        <OpportunityForm
          mode="create"
          owners={owners}
          defaultOwnerUserId={user.id}
        />
      </Panel>
    </>
  );
}
