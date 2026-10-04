import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { formatDollars } from "@/lib/money";
import { loadReportOpportunities, reportsRefusal } from "@/lib/reports";
import { buildReport, formatRate, parseReportRange, REPORT_RANGE_LABELS } from "@/lib/reports-logic";
import { ReportsClient } from "./ReportsClient";

export const dynamic = "force-dynamic";

/**
 * BL-PACKAGES add-ons Slice 2c — Reports: win rate by agency, NAICS and
 * set-aside, the stage funnel with conversion, and twelve months of
 * opportunities created and won, each downloadable as CSV. Behind the
 * `advancedReporting` flag (a tier, an override or a feature add-on).
 */
export default async function ReportsPage({ searchParams }: { searchParams: { range?: string } }) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const refusal = await reportsRefusal(organizationId);

  if (refusal) {
    return (
      <>
        <PageHeader eyebrow="Platform Intelligence · Reports" title="Reports" subtitle="Win rates, the stage funnel and pipeline trends for your workspace." />
        <Panel title="Not in your plan" eyebrow="Reports">
          <p className="font-body text-[14px] leading-relaxed text-muted">{refusal}</p>
          <Link href="/settings/billing" className="aur-btn aur-btn-primary mt-3 inline-block">
            Open billing
          </Link>
        </Panel>
      </>
    );
  }

  const range = parseReportRange(searchParams.range);
  const report = buildReport(await loadReportOpportunities(organizationId), range);
  const s = report.summary;

  return (
    <>
      <PageHeader
        eyebrow="Platform Intelligence · Reports"
        title="Reports"
        subtitle={`Opportunities created ${REPORT_RANGE_LABELS[range].toLowerCase()}. Win rate counts won ÷ (won + lost); no-bids are shown beside it.`}
        meta={[
          { label: "Opportunities", value: String(s.total) },
          { label: "Win rate", value: formatRate(s.winRate), accent: "emerald" },
          { label: "Won value", value: formatDollars(s.wonValue) },
          { label: "Open pipeline", value: formatDollars(s.openValue) },
        ]}
      />
      <ReportsClient report={report} />
    </>
  );
}
