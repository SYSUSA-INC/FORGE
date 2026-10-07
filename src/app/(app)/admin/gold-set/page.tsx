import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { requireSuperadmin } from "@/lib/auth-helpers";
import { listEvalRuns } from "@/lib/extraction-eval";
import type { DocScore, RunSummary } from "@/lib/extraction-eval-logic";
import { listGoldDocs } from "@/lib/gold-set";
import { AccuracyPanel } from "./AccuracyPanel";
import { AddGoldDocForm } from "./AddGoldDocForm";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, string> = {
  draft: "text-muted",
  in_review: "text-gold",
  approved: "text-emerald",
};

/**
 * BL-AIX Phase 1e — the extraction gold set: public SAM.gov RFPs and the
 * reviewed annotations a correct extraction must find. Platform admins
 * only; it holds no tenant data.
 */
export default async function GoldSetPage() {
  await requireSuperadmin();
  const [docs, runs] = await Promise.all([listGoldDocs(), listEvalRuns()]);
  const approved = docs.filter((d) => d.status === "approved").length;

  return (
    <>
      <PageHeader
        eyebrow="Platform admin · AI quality"
        title="Extraction gold set"
        subtitle={`Public RFPs annotated with every requirement, page limit and Section M factor a correct extraction must find. ${approved} of ${docs.length} document${docs.length === 1 ? "" : "s"} approved (the plan is 15–20, including 200-page packages, scans and multi-attachment notices).`}
      />
      <AccuracyPanel
        approvedDocs={approved}
        runs={runs.map((r) => ({
          id: r.id,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
          model: r.model,
          promptVersions: r.promptVersions,
          docsTotal: r.docIds.length,
          results: r.results as DocScore[],
          summary: r.summary as Partial<RunSummary>,
          error: r.error,
        }))}
      />
      <div className="mt-4" />
      <Panel title="Add an RFP" eyebrow="From a SAM.gov notice ID, or pasted text">
        <AddGoldDocForm />
      </Panel>
      <div className="mt-4">
        <Panel title="Documents">
          {docs.length === 0 ? (
            <p className="font-mono text-[11px] text-muted">No documents yet.</p>
          ) : (
            <table className="w-full font-mono text-[11px]">
              <thead className="text-[10px] uppercase tracking-[0.2em] text-subtle">
                <tr>
                  <th className="py-1 text-left">Document</th>
                  <th className="py-1 text-left">Status</th>
                  <th className="py-1 text-right">Text</th>
                  <th className="py-1 text-right">Requirements</th>
                  <th className="py-1 text-right">Limits</th>
                  <th className="py-1 text-right">Factors</th>
                  <th className="py-1 text-right">To review</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className="border-t border-layer/10">
                    <td className="py-1.5">
                      <Link href={`/admin/gold-set/${d.id}`} className="text-text underline-offset-2 hover:underline">
                        {d.title}
                      </Link>
                      <span className="text-muted">{d.solicitationNumber ? ` · ${d.solicitationNumber}` : ""}</span>
                    </td>
                    <td className={`py-1.5 ${STATUS_TONE[d.status] ?? "text-muted"}`}>{d.status.replace("_", " ")}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted">{Math.round(d.chars / 1000)}k chars</td>
                    <td className="py-1.5 text-right tabular-nums text-text">{d.progress.byKind.requirement.approved}</td>
                    <td className="py-1.5 text-right tabular-nums text-text">{d.progress.byKind.page_limit.approved}</td>
                    <td className="py-1.5 text-right tabular-nums text-text">{d.progress.byKind.eval_factor.approved}</td>
                    <td className="py-1.5 text-right tabular-nums text-gold">{d.progress.proposed || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </>
  );
}
