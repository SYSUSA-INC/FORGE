import { and, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { companies, opportunities, opportunityCapabilityMatrices } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { parseVersionOf } from "@/lib/capability-matrix-types";
import { latestReports } from "@/lib/opportunity-report-store";
import { loadOpportunityRequirements } from "@/lib/solicitation-requirements";
import { CapabilityMatrixPanel } from "../evaluation/CapabilityMatrixPanel";

export const dynamic = "force-dynamic";

/**
 * BL-NAV-LIFECYCLE phase 2b (FORGE II footnote 5, E-5 to E-8) — the
 * Capability Matrix on a page of its own: the questionnaire drafted from
 * the solicitation's requirements, answered Yes / Partial % / No, its
 * coverage and gaps. Evaluate's "Capability Matrix" opens it.
 */
export default async function OpportunityCapabilityPage({ params }: { params: { id: string } }) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const [opp] = await db
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(and(eq(opportunities.id, params.id), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  if (!opp) notFound();

  const [[matrix], reqs, partners, reports] = await Promise.all([
    db
      .select()
      .from(opportunityCapabilityMatrices)
      .where(and(eq(opportunityCapabilityMatrices.opportunityId, params.id), eq(opportunityCapabilityMatrices.organizationId, organizationId)))
      .limit(1),
    loadOpportunityRequirements({ organizationId, opportunityId: params.id }),
    db
      .select({ id: companies.id, name: companies.name, relationship: companies.relationship })
      .from(companies)
      .where(and(eq(companies.organizationId, organizationId), inArray(companies.relationship, ["teaming_partner", "subcontractor"])))
      .orderBy(companies.name)
      .limit(200),
    latestReports(organizationId, params.id),
  ]);
  const matrixReport = reports.find((r) => r.kind === "matrix") ?? null;

  return (
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
      latestReport={matrixReport ? { id: matrixReport.id, version: matrixReport.version, createdAt: matrixReport.createdAt } : null}
    />
  );
}
