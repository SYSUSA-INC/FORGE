import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { opportunities, users } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { STAGES, STAGE_COLORS, STAGE_LABELS } from "@/lib/opportunity-types";
import {
  buildStageStats,
  type StageStat,
} from "./stage-stats";
import { OpportunitiesClient } from "./OpportunitiesClient";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage() {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const rows = await db
    .select({
      id: opportunities.id,
      title: opportunities.title,
      agency: opportunities.agency,
      stage: opportunities.stage,
      solicitationNumber: opportunities.solicitationNumber,
      valueLow: opportunities.valueLow,
      valueHigh: opportunities.valueHigh,
      responseDueDate: opportunities.responseDueDate,
      pWin: opportunities.pWin,
      ownerUserId: opportunities.ownerUserId,
      ownerName: users.name,
      ownerEmail: users.email,
      updatedAt: opportunities.updatedAt,
    })
    .from(opportunities)
    .leftJoin(users, eq(users.id, opportunities.ownerUserId))
    .where(eq(opportunities.organizationId, organizationId))
    .orderBy(desc(opportunities.updatedAt));

  // Stage aggregates: count + due-date proximity per stage. Computed
  // server-side so the client widgets render with real numbers, not
  // a flicker of zeros while client-side aggregation runs.
  const stats: Record<string, StageStat> = buildStageStats(rows);

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
      stageStats={stats}
      stages={STAGES}
    />
  );
}
