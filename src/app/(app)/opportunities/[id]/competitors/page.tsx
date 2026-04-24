import { and, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  opportunities,
  opportunityCompetitors,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { Panel } from "@/components/ui/Panel";
import { CompetitorsClient } from "./CompetitorsClient";

export const dynamic = "force-dynamic";

export default async function OpportunityCompetitorsPage({
  params,
}: {
  params: { id: string };
}) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [opp] = await db
    .select({ id: opportunities.id, incumbent: opportunities.incumbent })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.id, params.id),
        eq(opportunities.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!opp) notFound();

  const rows = await db
    .select()
    .from(opportunityCompetitors)
    .where(eq(opportunityCompetitors.opportunityId, params.id))
    .orderBy(asc(opportunityCompetitors.name));

  return (
    <Panel
      title="Competitive landscape"
      eyebrow={`${rows.length} ${rows.length === 1 ? "competitor" : "competitors"}`}
    >
      <CompetitorsClient
        opportunityId={params.id}
        incumbentFromOverview={opp.incumbent}
        competitors={rows.map((c) => ({
          id: c.id,
          name: c.name,
          isIncumbent: c.isIncumbent,
          pastPerformance: c.pastPerformance,
          strengths: c.strengths,
          weaknesses: c.weaknesses,
          notes: c.notes,
        }))}
      />
    </Panel>
  );
}
