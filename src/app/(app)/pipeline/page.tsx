import Link from "next/link";
import { and, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { opportunities } from "@/db/schema";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { buildFunnelData, formatDollars } from "./funnel-stats";
import { PipelineFilters } from "./PipelineFilters";
import { PipelineFunnel } from "./PipelineFunnel";

export const dynamic = "force-dynamic";

const VALID_WINDOWS = new Set(["30", "90", "365", "all"]);
const VALID_MODES = new Set(["count", "value"]);

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: { days?: string; mode?: string };
}) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();

  const windowKey =
    searchParams.days && VALID_WINDOWS.has(searchParams.days)
      ? (searchParams.days as "30" | "90" | "365" | "all")
      : "90";
  const mode =
    searchParams.mode && VALID_MODES.has(searchParams.mode)
      ? (searchParams.mode as "count" | "value")
      : "count";

  const sinceCutoff =
    windowKey === "all"
      ? null
      : new Date(Date.now() - Number(windowKey) * 24 * 60 * 60 * 1000);

  const whereClause = sinceCutoff
    ? and(
        eq(opportunities.organizationId, organizationId),
        gte(opportunities.createdAt, sinceCutoff),
      )
    : eq(opportunities.organizationId, organizationId);

  const rows = await db
    .select({
      stage: opportunities.stage,
      pWin: opportunities.pWin,
      valueLow: opportunities.valueLow,
      valueHigh: opportunities.valueHigh,
    })
    .from(opportunities)
    .where(whereClause);

  const data = buildFunnelData(rows);

  const headerActions = (
    <>
      <Link href="/opportunities/import" className="aur-btn">
        Import from SAM.gov
      </Link>
      <Link href="/opportunities/new" className="aur-btn aur-btn-primary">
        + New opportunity
      </Link>
    </>
  );

  if (data.totalCount === 0) {
    return (
      <>
        <PageHeader
          eyebrow="Pipeline"
          title="Opportunity pipeline"
          subtitle={
            sinceCutoff
              ? `No opportunities created in this window. Widen the time range or seed new pursuits.`
              : "No opportunities yet. Create one or import a batch from SAM.gov."
          }
          actions={headerActions}
        />
        <PipelineFilters currentWindow={windowKey} currentMode={mode} />
        <Panel title="Empty pipeline">
          <p className="font-body text-[14px] leading-relaxed text-muted">
            {sinceCutoff
              ? "Try a longer time window to include older pursuits, or add new opportunities."
              : "Create one manually or import a batch from SAM.gov to populate the pipeline."}
          </p>
          <div className="mt-4 flex gap-2">
            <Link href="/opportunities/new" className="aur-btn aur-btn-primary">
              + New opportunity
            </Link>
            <Link href="/opportunities/import" className="aur-btn">
              Import from SAM.gov
            </Link>
          </div>
        </Panel>
      </>
    );
  }

  const activeCount = data.active.reduce((s, x) => s + x.count, 0);

  return (
    <>
      <PageHeader
        eyebrow="Pipeline"
        title="Opportunity pipeline"
        subtitle={
          sinceCutoff
            ? `Funnel view across the seven active stages — opportunities created in the last ${windowKey} days.`
            : "Funnel view across the seven active stages — every opportunity in your tenant."
        }
        actions={headerActions}
        meta={[
          {
            label: "In window",
            value: String(data.totalCount).padStart(2, "0"),
          },
          {
            label: "Active",
            value: String(activeCount).padStart(2, "0"),
            accent: activeCount > 0 ? "magenta" : undefined,
          },
          {
            label: "Win rate",
            value: data.winRate === null ? "—" : `${data.winRate}%`,
            accent:
              data.winRate !== null && data.winRate >= 40
                ? "emerald"
                : data.winRate !== null && data.winRate >= 20
                  ? "gold"
                  : undefined,
          },
          {
            label: mode === "value" ? "Weighted value" : "Pipeline value",
            value: formatDollars(data.totalWeightedValue),
          },
        ]}
      />

      <PipelineFilters currentWindow={windowKey} currentMode={mode} />

      <Panel
        title="Stage funnel"
        eyebrow={
          mode === "value"
            ? "Width = PWin% × midpoint of value range"
            : "Width = number of opportunities in stage"
        }
      >
        <PipelineFunnel data={data} mode={mode} />
      </Panel>
    </>
  );
}
