import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import type { OpportunityStage } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { getOrganizationSnapshot } from "@/lib/org-snapshot";
import { STAGES, STAGE_COLORS, STAGE_LABELS } from "@/lib/opportunity-types";
import { OpportunitiesClient } from "./OpportunitiesClient";

export const dynamic = "force-dynamic";

const VALID_STAGES = new Set(STAGES.map((s) => s.key));

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: { stage?: string };
}) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  // Deep-link from Command Center tiles: /opportunities?stage=capture
  const requestedStage =
    searchParams.stage && VALID_STAGES.has(searchParams.stage as OpportunityStage)
      ? (searchParams.stage as OpportunityStage)
      : null;

  const snapshot = await getOrganizationSnapshot(organizationId);

  const list = snapshot.oppRows.map((r) => ({
    id: r.id,
    title: r.title,
    agency: r.agency,
    stage: r.stage,
    stageLabel: STAGE_LABELS[r.stage],
    stageColor: STAGE_COLORS[r.stage],
    solicitationNumber: r.solicitationNumber,
    valueLow: r.valueLow,
    valueHigh: r.valueHigh,
    responseDueDate: r.responseDueDate ? r.responseDueDate.toISOString() : null,
    pWin: r.pWin,
    owner:
      r.ownerName || r.ownerEmail
        ? {
            userId: r.ownerUserId!,
            name: r.ownerName,
            email: r.ownerEmail!,
          }
        : null,
    updatedAt: r.updatedAt.toISOString(),
  }));

  if (list.length === 0) {
    return (
      <>
        <PageHeader
          eyebrow="Capture"
          title="Opportunities"
          subtitle="Track opportunities from identification through submission."
          actions={
            <>
              <Link href="/opportunities/import" className="aur-btn aur-btn-ghost">
                Import from SAM.gov
              </Link>
              <Link href="/opportunities/new" className="aur-btn aur-btn-primary">
                + New opportunity
              </Link>
            </>
          }
        />
        <Panel title="No opportunities yet">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted">
              Add your first opportunity to start tracking. You can enter details
              manually or paste a SAM.gov notice ID.
            </p>
            <Link
              href="/opportunities/new"
              className="aur-btn aur-btn-primary self-start"
            >
              Create opportunity
            </Link>
          </div>
        </Panel>
      </>
    );
  }

  return (
    <OpportunitiesClient
      opportunities={list}
      stageStats={snapshot.oppStageStats}
      stages={STAGES}
      initialStageFilter={requestedStage ?? "all"}
    />
  );
}
