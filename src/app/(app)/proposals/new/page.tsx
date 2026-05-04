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
import { LauncherCard } from "./LauncherCard";
import { OpportunityPicker } from "./OpportunityPicker";

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

  const preselected = searchParams.opportunityId;
  const launcherMode = !preselected;

  if (launcherMode) {
    return (
      <>
        <PageHeader
          eyebrow="Proposals"
          title="New proposal"
          subtitle="Choose how to start. Pick from the existing opportunity queue, or create a new opportunity first."
          actions={
            <Link href="/proposals" className="aur-btn aur-btn-ghost">
              Cancel
            </Link>
          }
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <LauncherCard
            eyebrow="Path 1"
            title="Use existing opportunity"
            description={
              opps.length === 0
                ? "You don't have any opportunities in the queue yet — use Path 2 to add one."
                : `Pick an opportunity from your pipeline (${opps.length} active). Build the proposal on top of it.`
            }
          >
            {opps.length === 0 ? (
              <div className="font-mono text-[11px] text-muted">
                No opportunities yet.
              </div>
            ) : (
              <OpportunityPicker opportunities={opps} />
            )}
          </LauncherCard>

          <LauncherCard
            eyebrow="Path 2"
            title="Create from scratch"
            description="Add a new opportunity, then build the proposal on top of it. Two short steps."
          >
            <Link
              href="/opportunities/new?afterCreate=proposal"
              className="aur-btn aur-btn-primary inline-flex w-full items-center justify-center"
            >
              Start fresh →
            </Link>
            <div className="mt-2 font-mono text-[10px] text-muted">
              Saves the opportunity, then chains you straight into the
              proposal setup.
            </div>
          </LauncherCard>
        </div>
      </>
    );
  }

  // Pre-selected mode — user picked an opp on the launcher (or got
  // redirected here from /opportunities/new?afterCreate=proposal).
  // Show the existing form pre-selected.
  return (
    <>
      <PageHeader
        eyebrow="Proposals"
        title="New proposal"
        subtitle="Step 2 of 2 — set up the proposal. Default sections will be created automatically."
        actions={
          <Link href="/proposals/new" className="aur-btn aur-btn-ghost">
            ← Back to launcher
          </Link>
        }
      />
      <Panel title="Proposal setup">
        {opps.length === 0 ? (
          <div className="flex flex-col gap-3 font-mono text-[12px] text-muted">
            <p>
              The selected opportunity is no longer available. Go back to the
              launcher to pick another or create a new one.
            </p>
            <Link
              href="/proposals/new"
              className="aur-btn aur-btn-primary self-start"
            >
              Back to launcher
            </Link>
          </div>
        ) : (
          <NewProposalForm
            opportunities={opps}
            teamCandidates={team}
            templates={templates}
            currentUserId={user.id}
            defaultOpportunityId={preselected}
          />
        )}
      </Panel>
    </>
  );
}
