import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { listOpportunityOwners } from "../actions";
import { OpportunityForm } from "../OpportunityForm";

export const dynamic = "force-dynamic";

export default async function NewOpportunityPage({
  searchParams,
}: {
  searchParams: { afterCreate?: string };
}) {
  const user = await requireAuth();
  await requireCurrentOrg();
  const owners = await listOpportunityOwners();

  // The proposal launcher routes here with `?afterCreate=proposal`
  // when the user picks "create from scratch" — after the opportunity
  // saves, the form chains the user back into proposal creation
  // pre-selected to this new opp.
  const afterCreate =
    searchParams.afterCreate === "proposal" ? "proposal" : undefined;

  return (
    <>
      <PageHeader
        eyebrow="Capture"
        title="New opportunity"
        subtitle={
          afterCreate === "proposal"
            ? "Step 1 of 2 — capture the opportunity. We'll move you to the proposal setup once it saves."
            : "Add a lead, RFI, or pre-RFP notice you want to pursue."
        }
        actions={
          <Link
            href={afterCreate === "proposal" ? "/proposals/new" : "/opportunities"}
            className="aur-btn aur-btn-ghost"
          >
            Cancel
          </Link>
        }
      />
      <Panel title="Opportunity details">
        <OpportunityForm
          mode="create"
          owners={owners}
          defaultOwnerUserId={user.id}
          afterCreate={afterCreate}
        />
      </Panel>
    </>
  );
}
