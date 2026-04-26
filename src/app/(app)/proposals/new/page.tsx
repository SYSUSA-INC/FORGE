import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import {
  listOpportunitiesForProposal,
  listProposalTeamCandidates,
} from "../actions";
import { listActiveTemplatesForPickerAction } from "../../settings/templates/actions";
import { NewProposalForm } from "./NewProposalForm";

export const dynamic = "force-dynamic";

export default async function NewProposalPage({
  searchParams,
}: {
  searchParams: { opportunityId?: string };
}) {
  const user = await requireAuth();
  await requireCurrentOrg();
  const [opps, team, templates] = await Promise.all([
    listOpportunitiesForProposal(),
    listProposalTeamCandidates(),
    listActiveTemplatesForPickerAction(),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Proposals"
        title="New proposal"
        subtitle="Create a proposal tied to an opportunity. Default sections and a draft stage will be set up automatically."
        actions={
          <Link href="/proposals" className="aur-btn aur-btn-ghost">
            Cancel
          </Link>
        }
      />
      <Panel title="Proposal setup">
        {opps.length === 0 ? (
          <div className="flex flex-col gap-3 font-mono text-[12px] text-muted">
            <p>
              You need an opportunity before you can create a proposal. Go create
              one first.
            </p>
            <Link
              href="/opportunities/new"
              className="aur-btn aur-btn-primary self-start"
            >
              Create an opportunity
            </Link>
          </div>
        ) : (
          <NewProposalForm
            opportunities={opps}
            teamCandidates={team}
            templates={templates}
            currentUserId={user.id}
            defaultOpportunityId={searchParams.opportunityId}
          />
        )}
      </Panel>
    </>
  );
}
