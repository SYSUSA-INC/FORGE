import { and, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import {
  opportunities,
  opportunityEvaluations,
  opportunityCapabilityMatrices,
  companies,
} from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { Panel } from "@/components/ui/Panel";
import { EvaluationForm } from "./EvaluationForm";
import { GateDecisionPanel } from "./GateDecisionPanel";
import { CapabilityMatrixPanel } from "./CapabilityMatrixPanel";
import { loadOpportunityRequirements } from "@/lib/solicitation-requirements";
import { parseVersionOf } from "@/lib/capability-matrix-types";

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

  // BL-CAP-MATRIX — the questionnaire row, the requirement set it should
  // match, and the companies a gap could be covered by.
  const [matrix] = await db
    .select()
    .from(opportunityCapabilityMatrices)
    .where(
      and(
        eq(opportunityCapabilityMatrices.opportunityId, params.id),
        eq(opportunityCapabilityMatrices.organizationId, organizationId),
      ),
    )
    .limit(1);
  const reqs = await loadOpportunityRequirements({ organizationId, opportunityId: params.id });
  const partners = await db
    .select({ id: companies.id, name: companies.name, relationship: companies.relationship })
    .from(companies)
    .where(
      and(
        eq(companies.organizationId, organizationId),
        inArray(companies.relationship, ["teaming_partner", "subcontractor"]),
      ),
    )
    .orderBy(companies.name)
    .limit(200);

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
      <div className="xl:col-span-3">
        <CapabilityMatrixPanel
          opportunityId={params.id}
          matrix={
            matrix
              ? {
                  questions: matrix.questions,
                  answers: matrix.answers,
                  suggestions: matrix.suggestions,
                  parseVersion: matrix.parseVersion,
                  builtAt: matrix.builtAt ? matrix.builtAt.toISOString() : null,
                }
              : null
          }
          currentParseVersion={parseVersionOf(reqs)}
          hasRequirements={reqs.requirements.length > 0}
          partners={partners}
        />
      </div>
    </div>
  );
}
