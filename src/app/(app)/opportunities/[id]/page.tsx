import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { opportunities } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { Panel } from "@/components/ui/Panel";
import { OpportunityForm } from "../OpportunityForm";
import { listOpportunityOwners } from "../actions";
import { OpportunityBriefPanel } from "./ai/OpportunityBriefPanel";

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
        <OpportunityBriefPanel opportunityId={opp.id} />
      </div>
    </div>
  );
}
