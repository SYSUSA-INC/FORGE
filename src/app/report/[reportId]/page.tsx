import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { asMatrixReport, REPORT_LABELS, type MatrixReportRow } from "@/lib/opportunity-report";
import { getReport } from "@/lib/opportunity-report-store";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

const ANSWER_TONE: Record<NonNullable<MatrixReportRow["answer"]>, string> = {
  yes: "text-green",
  partial: "text-brass",
  no: "text-red",
  na: "text-muted",
};

const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);
const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/**
 * BL-NAV-LIFECYCLE phase 2b-2 (FORGE II footnote 5, E-8, E-9) — a saved
 * report as a page of its own, outside the app's frame so it prints
 * cleanly (Print or save as PDF). This organization's reports only.
 */
export default async function ReportPage({ params }: { params: { reportId: string } }) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const found = await getReport(organizationId, params.reportId);
  if (!found) notFound();
  const { report, versions } = found;
  const m = asMatrixReport(report.body);
  if (!m) notFound();

  const areas = [...new Set(m.rows.map((r) => r.area))];

  return (
    <main className="min-h-screen bg-canvas text-text print:bg-white print:text-black">
      <div className="mx-auto max-w-4xl px-6 py-8 print:max-w-none print:px-0 print:py-0">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link href={`/opportunities/${report.opportunityId}/capability`} className="aur-link font-mono text-[11px] uppercase tracking-widest">
            ← Back to the opportunity
          </Link>
          <div className="flex items-center gap-3">
            {versions.length > 1 ? (
              <nav aria-label="Versions" className="flex flex-wrap gap-1 font-mono text-[11px]">
                {versions.map((v) => (
                  <Link key={v.id} href={`/report/${v.id}`} aria-current={v.id === report.id ? "page" : undefined} className={`rounded border px-1.5 py-0.5 ${v.id === report.id ? "border-accent/50 text-text" : "border-layer/10 text-muted hover:text-text"}`}>
                    v{v.version}
                  </Link>
                ))}
              </nav>
            ) : null}
            <PrintButton />
          </div>
        </div>

        <header className="border-b border-layer/10 pb-4">
          <p className="font-mono text-[11px] uppercase tracking-label text-accent print:text-black">
            {REPORT_LABELS.matrix} · version {report.version} · {day(report.createdAt)}
            {report.by ? ` · ${report.by}` : ""}
          </p>
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">{m.opportunity.title}</h1>
          <p className="mt-1 font-body text-[13px] text-muted">
            {[m.opportunity.agency, m.opportunity.solicitationNumber, m.opportunity.naics ? `NAICS ${m.opportunity.naics}` : "", m.opportunity.dueDate ? `due ${day(m.opportunity.dueDate)}` : ""].filter(Boolean).join(" · ")}
          </p>
        </header>

        <section aria-label="Summary" className="grid grid-cols-2 gap-4 border-b border-layer/10 py-4 md:grid-cols-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-label text-muted">Coverage</div>
            <div className="font-display text-2xl">{pct(m.coverage)}</div>
            <div className="font-mono text-[10px] text-muted">{m.shallCoverage === null ? "no shall answers" : `${pct(m.shallCoverage)} of shall`}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-label text-muted">Partner</div>
            <div className={`font-display text-2xl ${m.partnerNeeded ? "text-brass" : ""}`}>{m.partnerNeeded ? "Needed" : "Not needed"}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-label text-muted">Answers</div>
            <div className="font-mono text-[12px]">
              Yes {m.counts.yes} · Partial {m.counts.partial} · No {m.counts.no}
              {m.counts.na ? ` · N/A ${m.counts.na}` : ""}
            </div>
            {m.counts.unanswered ? <div className="font-mono text-[10px] text-brass">{m.counts.unanswered} not answered</div> : null}
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-label text-muted">Gaps</div>
            <div className="font-display text-2xl">{m.gaps.length}</div>
          </div>
        </section>

        {m.gaps.length > 0 ? (
          <section aria-label="Gaps" className="border-b border-layer/10 py-4">
            <h2 className="mb-2 font-mono text-[11px] uppercase tracking-label text-muted">Gaps</h2>
            <ul className="flex flex-col gap-1">
              {m.gaps.map((g) => (
                <li key={g.text} className="font-body text-[13px]">
                  {g.text}
                  {g.refs.length ? <span className="ml-2 font-mono text-[11px] text-muted">{g.refs.join(", ")}</span> : null}
                  <span className="ml-2 font-mono text-[11px] text-muted">{g.partner ? `partner: ${g.partner}` : "no partner named"}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {areas.map((area) => (
          <section key={area} aria-label={area} className="break-inside-avoid py-4">
            <h2 className="mb-2 font-mono text-[11px] uppercase tracking-label text-muted">{area}</h2>
            <table className="w-full border-collapse font-body text-[13px]">
              <tbody>
                {m.rows
                  .filter((r) => r.area === area)
                  .map((r) => (
                    <tr key={r.id} className="border-t border-layer/10 align-top">
                      <td className="py-2 pr-3">
                        {r.text}
                        <div className="font-mono text-[10px] text-muted">
                          {[r.kind !== "standing" ? r.kind : "", ...r.refs].filter(Boolean).join(" · ")}
                        </div>
                        {r.evidence ? <div className="mt-1 text-[12px] text-muted">Evidence: {r.evidence}</div> : null}
                      </td>
                      <td className={`w-48 py-2 font-mono text-[12px] ${r.answer ? ANSWER_TONE[r.answer] : "text-subtle"} print:text-black`}>
                        {r.label}
                        {r.partner ? <div className="text-[11px] text-muted">{r.partner}</div> : null}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </section>
        ))}

        <footer className="mt-6 border-t border-layer/10 pt-3 font-mono text-[10px] text-muted">
          FORGE · {REPORT_LABELS.matrix} v{report.version} saved {new Date(report.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC. A later change to the matrix does not change this report.
        </footer>
      </div>
    </main>
  );
}
