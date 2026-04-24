import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  opportunities,
  opportunityEvaluations,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { Panel } from "@/components/ui/Panel";
import { EvaluationForm } from "./EvaluationForm";
import { GateDecisionPanel } from "./GateDecisionPanel";

export const dynamic = "force-dynamic";

export default async function OpportunityEvaluationPage({
  params,
}: {
  params: { id: string };
}) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const [opp] = await db
    .select({ id: opportunities.id, stage: opportunities.stage })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.id, params.id),
        eq(opportunities.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!opp) notFound();

  const [existing] = await db
    .select()
    .from(opportunityEvaluations)
    .where(eq(opportunityEvaluations.opportunityId, params.id))
    .limit(1);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <Panel title="Qualification scorecard" eyebrow="Weighted evaluation">
          <EvaluationForm opportunityId={params.id} initial={existing ?? null} />
        </Panel>
      </div>
      <div>
        <GateDecisionPanel opportunityId={params.id} currentStage={opp.stage} />
      </div>
    </div>
  );
}
