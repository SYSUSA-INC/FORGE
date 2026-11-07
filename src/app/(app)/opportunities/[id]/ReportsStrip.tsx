import Link from "next/link";
import { requireCurrentOrg } from "@/lib/auth-helpers";
import { DECISION_LABELS } from "@/lib/opportunity-decision";
import { decisionHistory } from "@/lib/opportunity-decision-store";
import { REPORT_LABELS } from "@/lib/opportunity-report";
import { latestReports } from "@/lib/opportunity-report-store";
import { safeQuery } from "@/lib/schema-resilience";

const DECISION_TONE = { go: "text-green", no_go: "text-red", partner: "text-indigo" } as const;

/**
 * BL-NAV-LIFECYCLE phase 2b-2 (FORGE II E-9) — the opportunity's reports
 * on its Overview, each with its date, plus the Evaluate decision once
 * made; they stay here through Capture, Plan and Develop. Renders nothing
 * until there is something to show.
 */
export async function ReportsStrip({ opportunityId }: { opportunityId: string }) {
  const { organizationId } = await requireCurrentOrg();
  const [reports, decisions] = await Promise.all([
    safeQuery(() => latestReports(organizationId, opportunityId), [], { tag: "opportunity.reports" }),
    safeQuery(() => decisionHistory(organizationId, opportunityId), [], { tag: "opportunity.reports.decision" }),
  ]);
  const matrix = reports.find((r) => r.kind === "matrix") ?? null;
  const analysis = reports.find((r) => r.kind === "analysis") ?? null;
  const decision = decisions[0] ?? null;
  if (!matrix && !analysis && !decision) return null;
  return (
    <section aria-label="Reports" className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-layer/10 pb-3">
      <span className="font-mono text-[10px] uppercase tracking-label text-muted">Reports</span>
      {analysis ? (
        <Link href={`/report/${analysis.id}`} className="font-body text-[13px] text-text hover:underline">
          {REPORT_LABELS.analysis} <span className="font-mono text-[11px] text-muted">v{analysis.version} · {analysis.createdAt.slice(0, 10)}</span>
        </Link>
      ) : (
        <Link href={`/opportunities/${opportunityId}/analysis`} className="font-body text-[13px] text-muted hover:text-text">
          No {REPORT_LABELS.analysis} yet
        </Link>
      )}
      {matrix ? (
        <Link href={`/report/${matrix.id}`} className="font-body text-[13px] text-text hover:underline">
          {REPORT_LABELS.matrix} <span className="font-mono text-[11px] text-muted">v{matrix.version} · {matrix.createdAt.slice(0, 10)}</span>
        </Link>
      ) : (
        <Link href={`/opportunities/${opportunityId}/capability`} className="font-body text-[13px] text-muted hover:text-text">
          No {REPORT_LABELS.matrix} yet
        </Link>
      )}
      {decision ? (
        <Link href={`/opportunities/${opportunityId}/evaluation#decision`} className="font-body text-[13px] text-text hover:underline">
          Decision <span className={`font-mono text-[11px] uppercase tracking-widest ${DECISION_TONE[decision.decision]}`}>{DECISION_LABELS[decision.decision]}</span>{" "}
          <span className="font-mono text-[11px] text-muted">{decision.at.slice(0, 10)}</span>
        </Link>
      ) : null}
    </section>
  );
}
