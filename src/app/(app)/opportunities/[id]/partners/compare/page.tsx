import Link from "next/link";
import { notFound } from "next/navigation";
import { Panel } from "@/components/ui/Panel";
import { requireAuth, requireCurrentOrg } from "@/lib/auth-helpers";
import { loadCapabilityMatrix, loadOwnedOpportunity } from "@/lib/capability-matrix-build";
import { companyNamesById, listPartnerAnswerSheets } from "@/lib/capture-store";
import { compareMatrix, type OurCell, type PartnerCell } from "@/lib/partner-compare-logic";
import { RatePanel } from "./RatePanel";

export const dynamic = "force-dynamic";

const KIND_LABEL = { shall: "Required", should: "Expected", may: "Desirable", standing: "Standing" } as const;

/** Status colours (DESIGN_SYSTEM §4): green yes, brass partial, red no, muted n/a or unanswered. */
const TONE: Record<string, string> = { yes: "text-green", partial: "text-brass", no: "text-red", na: "text-muted" };

function AnswerCell({ cell, closes, named }: { cell: OurCell | PartnerCell; closes?: boolean; named?: boolean }) {
  const a = cell.answer;
  const label = a === "yes" ? "Yes" : a === "partial" ? `Partial ${cell.percent ?? 50}%` : a === "no" ? "No" : a === "na" ? "N/A" : "—";
  return (
    <td className={`align-top px-3 py-2 ${closes ? "bg-cobalt/10" : ""}`}>
      <div className={`font-mono text-[11px] uppercase tracking-label ${a ? TONE[a] : "text-muted"}`}>
        {label}
        {closes ? <span className="ml-1 text-cobalt">closes</span> : null}
        {named ? <span className="ml-1 text-cobalt">named</span> : null}
      </div>
      {cell.evidence ? <p className="mt-0.5 line-clamp-3 font-body text-[12px] leading-[1.4] text-muted">{cell.evidence}</p> : null}
    </td>
  );
}

/**
 * BL-NAV-LIFECYCLE phase 3c-2 (C-6, C-7) — Compare: our answers and every
 * partner's side by side, one row per question, the partner that closes a
 * gap highlighted, and the company we named ourselves on a gap said on
 * the row (3c-3); and FORGE AI's rating of the partners below.
 */
export default async function ComparePartnersPage({ params }: { params: { id: string } }) {
  await requireAuth();
  const { organizationId } = await requireCurrentOrg();
  const [opp, matrix, partners] = await Promise.all([loadOwnedOpportunity(params.id, organizationId), loadCapabilityMatrix(params.id, organizationId), listPartnerAnswerSheets(organizationId, params.id)]);
  if (!opp) notFound();
  const questions = matrix?.questions ?? [];
  const cmp = compareMatrix(questions, matrix?.answers ?? {}, partners);
  const companyNames = await companyNamesById(organizationId, cmp.rows.flatMap((r) => (r.named ? [r.named.companyId] : [])));
  const back = `/opportunities/${params.id}/partners`;
  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Compare partners"
        eyebrow={`${questions.length} questions · ${cmp.gaps} gaps · ${partners.length} ${partners.length === 1 ? "partner" : "partners"} answered`}
        actions={
          <Link href={back} className="font-mono text-[11px] uppercase tracking-label text-cobalt hover:underline">
            ← Partners
          </Link>
        }
      >
        {questions.length === 0 ? (
          <p className="font-body text-[13px] leading-[1.5] text-muted">Build the capability questions under Evaluate first.</p>
        ) : partners.length === 0 ? (
          <p className="font-body text-[13px] leading-[1.5] text-muted">No partner has answered yet. Invite partners from the Partners tab; their answers appear here beside yours as they come in.</p>
        ) : (
          <>
            <p className="mb-3 font-body text-[13px] leading-[1.5] text-muted">
              Your answer first, then each partner&apos;s. A gap is a question you answered No or Partial; a partner <span className="text-cobalt">closes</span> it when it covers more than you do (Yes, or a Partial with a higher share). Where you named a company yourself on a gap under Evaluate, the row says so, and that partner&apos;s cell is marked <span className="text-cobalt">named</span>. Each partner saw the questions only, never your answers.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse font-body text-[13px]">
                <thead>
                  <tr className="border-b border-layer/10 text-left font-mono text-[10px] uppercase tracking-label text-muted">
                    <th className="px-3 py-2">Question</th>
                    <th className="px-3 py-2">Us</th>
                    {cmp.partners.map((p) => (
                      <th key={p.id} className="px-3 py-2">
                        {p.name}
                        <span className="ml-1 normal-case tracking-normal text-subtle">
                          {p.answered}/{questions.length} · closes {p.closed} of {cmp.gaps}
                          {p.named > 0 ? ` · named on ${p.named}` : ""}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cmp.rows.map((row) => (
                    <tr key={row.question.id} className={`border-b border-layer/10 align-top ${row.gap ? "bg-layer/5" : ""}`}>
                      <td className="px-3 py-2">
                        <p className="text-text">{row.question.text}</p>
                        <p className="font-mono text-[10px] uppercase tracking-label text-muted">
                          {KIND_LABEL[row.question.kind]} · {row.question.area || "General"}
                          {row.gap ? <span className="ml-1 text-brass">· gap{row.closedBy.length ? `, closed by ${row.closedBy.length}` : ", open"}</span> : null}
                          {row.named ? (
                            <span className="ml-1 normal-case tracking-normal text-cobalt">
                              · we named {companyNames.get(row.named.companyId) ?? "a company no longer on file"}
                              {row.named.partnerId ? "" : " (not among the partners compared)"}
                            </span>
                          ) : null}
                        </p>
                      </td>
                      <AnswerCell cell={row.ours} />
                      {cmp.partners.map((p) => (
                        <AnswerCell key={p.id} cell={row.cells[p.id]!} closes={row.cells[p.id]!.closes} named={row.cells[p.id]!.named} />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 font-mono text-[11px] text-muted">{partners.filter((p) => !p.answeredAt).length > 0 ? "A partner that saved a draft without submitting is shown too; its answers may still change." : "Every partner shown has submitted."}</p>
          </>
        )}
      </Panel>
      {partners.length > 0 && questions.length > 0 ? <RatePanel opportunityId={params.id} partnerCount={partners.length} /> : null}
    </div>
  );
}
