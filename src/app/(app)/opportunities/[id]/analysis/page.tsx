import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { opportunities } from "@/db/schema";
import { Panel } from "@/components/ui/Panel";
import { AnalysisReportView } from "@/components/reports/AnalysisReportView";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { asAnalysisReport } from "@/lib/opportunity-report";
import { getReport, latestReports } from "@/lib/opportunity-report-store";
import { RunAnalysisButton } from "./RunAnalysisButton";

export const dynamic = "force-dynamic";
// The analysis runs the PWin model, the pursuit brief and one AI call.
export const maxDuration = 120;

/**
 * BL-NAV-LIFECYCLE phase 2c (FORGE II footnote 5, E-3, E-4) — Analyze: the
 * opportunity's latest Analysis Report, and Run the analysis for a new
 * version. Evaluate's Analyze button opens it.
 */
export default async function OpportunityAnalysisPage({ params }: { params: { id: string } }) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const [opp] = await db
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(and(eq(opportunities.id, params.id), eq(opportunities.organizationId, organizationId)))
    .limit(1);
  if (!opp) notFound();
  const latest = (await latestReports(organizationId, params.id)).find((r) => r.kind === "analysis") ?? null;
  const found = latest ? await getReport(organizationId, latest.id) : null;
  const body = found ? asAnalysisReport(found.report.body) : null;

  return (
    <Panel
      title="Analysis Report"
      eyebrow={latest ? `Version ${latest.version} · ${latest.createdAt.slice(0, 10)}${latest.by ? ` · ${latest.by}` : ""}` : "Not run yet"}
      actions={
        <div className="flex flex-wrap items-center gap-3">
          {latest ? (
            <Link href={`/report/${latest.id}`} className="aur-link font-mono text-[11px] uppercase tracking-widest">
              Print or save as PDF{latest.versions > 1 ? ` · ${latest.versions} versions` : ""}
            </Link>
          ) : null}
          <RunAnalysisButton opportunityId={params.id} again={!!latest} />
        </div>
      }
    >
      {body ? (
        <AnalysisReportView body={body} />
      ) : (
        <p className="font-body text-[13px] leading-[1.5] text-muted">
          FORGE scores the win probability with its factors, reuses or writes the AI pursuit brief, and writes a short report tying them, the capability matrix and the competitors together: the call and why, fit, competition, risks, and what would raise PWin. Each run is kept as a dated version.
        </p>
      )}
    </Panel>
  );
}
