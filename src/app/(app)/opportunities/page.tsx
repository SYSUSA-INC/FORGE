import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { db } from "@/db";
import { opportunityCapabilityMatrices, type OpportunityStage } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { computeCapabilityCoverage } from "@/lib/capability-coverage";
import { getOrganizationSnapshot } from "@/lib/org-snapshot";
import { STAGES, STAGE_COLORS, STAGE_LABELS } from "@/lib/opportunity-types";
import { applyDrill, drillSummary, isDrill, parsePipelineDrill, pipelineHref, weightedValueOf } from "@/lib/pipeline-drill";
import { buildStageStats } from "./stage-stats";
import { OpportunitiesClient } from "./OpportunitiesClient";

export const dynamic = "force-dynamic";

const VALID_STAGES = new Set(STAGES.map((s) => s.key));

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: { stage?: string; days?: string; view?: string; mode?: string };
}) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  // Deep-link from Command Center tiles: /opportunities?stage=capture
  const requestedStage =
    searchParams.stage && VALID_STAGES.has(searchParams.stage as OpportunityStage)
      ? (searchParams.stage as OpportunityStage)
      : null;

  const snapshot = await getOrganizationSnapshot(organizationId);
  // BL-PIPE-DRILL — opened from a pipeline number: the same rows that number counts.
  const drill = parsePipelineDrill(searchParams);
  const drilled = isDrill(drill);
  const rows = drilled ? applyDrill(snapshot.oppRows, drill, new Date()) : snapshot.oppRows;

  // BL-CAP-MATRIX — the Qualified list carries each opportunity's capability
  // coverage (the questionnaire's confirmed answers), so the funnel's
  // Qualified band opens a list that says who is ready to bid and who needs
  // a partner. Loaded only for this stage: one org-scoped query over the
  // listed ids.
  const capability = new Map<string, { coverage: number | null; partnerNeeded: boolean; answered: number; total: number }>();
  if (requestedStage === "qualification" && rows.length > 0) {
    const matrices = await db
      .select({
        opportunityId: opportunityCapabilityMatrices.opportunityId,
        questions: opportunityCapabilityMatrices.questions,
        answers: opportunityCapabilityMatrices.answers,
      })
      .from(opportunityCapabilityMatrices)
      .where(
        and(
          eq(opportunityCapabilityMatrices.organizationId, organizationId),
          inArray(
            opportunityCapabilityMatrices.opportunityId,
            rows.map((r) => r.id),
          ),
        ),
      );
    for (const m of matrices) {
      const c = computeCapabilityCoverage(m.questions, m.answers);
      capability.set(m.opportunityId, { coverage: c.coverage, partnerNeeded: c.partnerNeeded, answered: c.answered, total: c.total });
    }
  }

  const list = rows.map((r) => ({
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
    weightedValue: drill.view === "valued" ? weightedValueOf(r) : null,
    capability: requestedStage === "qualification" ? (capability.get(r.id) ?? null) : undefined,
  }));

  if (list.length === 0 && !drilled) {
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
      // A new drill or stage (or "Show all") starts the list afresh: its filters are client state.
      key={`${requestedStage ?? ""}|${drilled ? `${drill.days}|${drill.view ?? ""}` : ""}`}
      opportunities={list}
      stageStats={drilled ? buildStageStats(rows) : snapshot.oppStageStats}
      stages={STAGES}
      initialStageFilter={requestedStage ?? "all"}
      drill={drilled ? { summary: drillSummary(rows, drill), backHref: pipelineHref(drill) } : null}
    />
  );
}
