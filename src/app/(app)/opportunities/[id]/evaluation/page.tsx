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
import { DecisionPanel } from "./DecisionPanel";
import { decisionHistory, evaluateSignals, partnerSuggestions } from "@/lib/opportunity-decision-store";
import { decisionReadiness } from "@/lib/opportunity-decision";
import { CapabilityMatrixPanel } from "./CapabilityMatrixPanel";
import { LessonsThatApplyPanel } from "./LessonsThatApplyPanel";
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
    .select({ id: opportunities.id, stage: opportunities.stage, agency: opportunities.agency, naicsCode: opportunities.naicsCode })
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

  // BL-NAV-LIFECYCLE 2a — the Evaluate decision while the opportunity is in
  // Evaluate (and its history after; it can still change in Capture, as a
  // new record); the gate panel moves it on from Capture.
  const inEvaluate = opp.stage === "identified" || opp.stage === "sources_sought";
  const [history, suggestions, signals] = await Promise.all([
    decisionHistory(organizationId, params.id),
    partnerSuggestions(organizationId, params.id),
    evaluateSignals(organizationId, [params.id]),
  ]);
  const sig = signals.get(params.id);
  const readiness = decisionReadiness({ analysed: !!sig?.analysed, matrixBuilt: (matrix?.questions?.length ?? 0) > 0 });

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <div className="xl:col-span-2">
        <Panel title="Qualification scorecard" eyebrow="Weighted evaluation">
          <EvaluationForm opportunityId={params.id} initial={existing ?? null} />
        </Panel>
      </div>
      <div className="flex flex-col gap-4">
        {inEvaluate || history.length > 0 ? (
          <DecisionPanel opportunityId={params.id} history={history} partners={suggestions} readiness={inEvaluate ? readiness : null} naics={opp.naicsCode} canDecide={inEvaluate || opp.stage === "qualification"} />
        ) : null}
        {inEvaluate ? null : <GateDecisionPanel opportunityId={params.id} currentStage={opp.stage} />}
        {/* BL-LESSONS-LOOP 4b — confirmed lessons from bids like this one. */}
        <LessonsThatApplyPanel agency={opp.agency} naicsCode={opp.naicsCode} />
      </div>
      <div id="capability" className="scroll-mt-24 xl:col-span-3">
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
