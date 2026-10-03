import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { opportunities } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { getBriefTrack, latestBrief, toStoredBrief } from "@/lib/briefs";
import { safeQuery } from "@/lib/schema-resilience";
import { Panel } from "@/components/ui/Panel";
import { OpportunityForm } from "../OpportunityForm";
import { listOpportunityOwners } from "../actions";
import { OpportunityBriefPanel } from "./ai/OpportunityBriefPanel";
import { CustomerContactsPanel } from "./CustomerContactsPanel";
import { OpportunityDocsAndAIPanel } from "./OpportunityDocsAndAIPanel";
import { PwinPanel } from "./PwinPanel";
import { RecompeteRadarPanel } from "@/components/intelligence/RecompeteRadarPanel";

export const dynamic = "force-dynamic";

function toIsoOrNull(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export default async function OpportunityOverviewPage({
  params,
}: {
  params: { id: string };
}) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [opp] = await db
    .select()
    .from(opportunities)
    .where(
      and(
        eq(opportunities.id, params.id),
        eq(opportunities.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!opp) notFound();

  const owners = await listOpportunityOwners();

  // BL-AIP-7a — the last stored pursuit brief and how past calls held up.
  const [briefRow, briefTrack] = await Promise.all([
    safeQuery(
      () => latestBrief({ organizationId, kind: "pursuit", opportunityId: opp.id }),
      null,
      { tag: "opportunity.brief" },
    ),
    safeQuery(() => getBriefTrack({ organizationId }), {
      n: 0,
      correct: 0,
      wrong: 0,
      inconclusive: 0,
      accuracy: null,
    }, { tag: "opportunity.briefTrack" }),
  ]);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
      <Panel title="Opportunity details">
        <OpportunityForm
          mode="edit"
          id={opp.id}
          owners={owners}
          initial={{
            title: opp.title,
            agency: opp.agency,
            office: opp.office,
            stage: opp.stage,
            solicitationNumber: opp.solicitationNumber,
            noticeId: opp.noticeId,
            valueLow: opp.valueLow,
            valueHigh: opp.valueHigh,
            releaseDate: toIsoOrNull(opp.releaseDate),
            responseDueDate: toIsoOrNull(opp.responseDueDate),
            awardDate: toIsoOrNull(opp.awardDate),
            naicsCode: opp.naicsCode,
            pscCode: opp.pscCode,
            setAside: opp.setAside,
            contractType: opp.contractType,
            placeOfPerformance: opp.placeOfPerformance,
            incumbent: opp.incumbent,
            description: opp.description,
            pWin: opp.pWin,
            ownerUserId: opp.ownerUserId,
          }}
        />
      </Panel>
      <div className="flex flex-col gap-4">
        {/* BL-FB-WIN-RECOMPETE — have we bid this before? Renders nothing when not. */}
        <RecompeteRadarPanel
          organizationId={organizationId}
          target={{ kind: "opportunity", id: opp.id }}
        />
        <PwinPanel organizationId={organizationId} opportunityId={opp.id} />
        {/* BL-FB-X-CRM — who we know at this agency; nothing when the agency is blank. */}
        <CustomerContactsPanel organizationId={organizationId} opportunityId={opp.id} />
        <OpportunityBriefPanel
          opportunityId={opp.id}
          initial={briefRow ? toStoredBrief(briefRow) : null}
          track={briefTrack}
        />
        <OpportunityDocsAndAIPanel opportunityId={opp.id} />
      </div>
    </div>
  );
}
