import Link from "next/link";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { solicitations } from "@/db/schema";
import { Panel } from "@/components/ui/Panel";
import { requireCurrentOrg } from "@/lib/auth-helpers";
import { RECOMMENDATION_LABELS, isRecommendation } from "@/lib/brief-logic";
import { DECISION_LABELS, EVALUATE_FILTERS, daysLeft, matchesEvaluateFilter, type EvaluateFilter } from "@/lib/opportunity-decision";
import { evaluateSignals, type EvaluateSignals } from "@/lib/opportunity-decision-store";
import { safeQuery } from "@/lib/schema-resilience";
import type { StageListRow } from "./StageList";

const DECISION_TONE = { go: "text-green", no_go: "text-red", partner: "text-indigo" } as const;

/**
 * BL-NAV-LIFECYCLE phase 2a (FORGE II footnote 5, E-1, E-2) — the Evaluate
 * page: every opportunity at Identified or Sources sought, one row each
 * with its Analyze and Capability Matrix and, once both exist, the
 * decision. Below, the solicitation documents not yet on an opportunity
 * (the old Solicitations list), each with Create opportunity from it.
 */
export async function EvaluateSection({ rows, filter }: { rows: StageListRow[]; filter: EvaluateFilter }) {
  const { organizationId } = await requireCurrentOrg();
  const signals = await safeQuery<Map<string, EvaluateSignals>>(() => evaluateSignals(organizationId, rows.map((r) => r.id)), new Map(), { tag: "pipeline.evaluate.signals" });
  const docs = await safeQuery(
    () =>
      db
        .select({ id: solicitations.id, title: solicitations.title, fileName: solicitations.fileName, agency: solicitations.agency, number: solicitations.solicitationNumber, due: solicitations.responseDueDate, status: solicitations.parseStatus, createdAt: solicitations.createdAt })
        .from(solicitations)
        .where(and(eq(solicitations.organizationId, organizationId), isNull(solicitations.opportunityId), isNull(solicitations.parentSolicitationId)))
        .orderBy(desc(solicitations.createdAt))
        .limit(50),
    [],
    { tag: "pipeline.evaluate.docs" },
  );

  const all = rows.map((r) => {
    const s = signals.get(r.id);
    return { r, s, analysed: !!s?.analysed, matrixBuilt: (s?.questions ?? 0) > 0 };
  });
  const counts = Object.fromEntries(EVALUATE_FILTERS.map((f) => [f.key, all.filter((x) => matchesEvaluateFilter(x, f.key)).length]));
  const shown = all.filter((x) => matchesEvaluateFilter(x, filter));

  return (
    <div className="flex flex-col gap-4">
      <Panel title="To evaluate" eyebrow={`${rows.length} ${rows.length === 1 ? "opportunity" : "opportunities"}`}>
        <nav aria-label="Evaluate filters" className="mb-3 flex flex-wrap gap-1">
          {EVALUATE_FILTERS.map((f) => (
            <Link
              key={f.key}
              href={f.key === "all" ? "/pipeline/evaluate" : `/pipeline/evaluate?filter=${f.key}`}
              aria-current={filter === f.key ? "page" : undefined}
              className={`rounded border px-2 py-1 font-mono text-[11px] ${filter === f.key ? "border-accent/50 bg-accent/10 text-text" : "border-layer/10 text-muted hover:text-text"}`}
            >
              {f.label} <span className="text-subtle">{counts[f.key]}</span>
            </Link>
          ))}
        </nav>
        {shown.length === 0 ? (
          <p className="font-body text-[13px] leading-[1.5] text-muted">{rows.length === 0 ? "Nothing is waiting for evaluation. Opportunities you add under Identify arrive here." : "Nothing under this filter."}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-layer/10">
            {shown.map(({ r, s, analysed, matrixBuilt }) => {
              const days = daysLeft(r.responseDueDate);
              const call = s?.call && isRecommendation(s.call) ? RECOMMENDATION_LABELS[s.call] : null;
              const decision = s?.decision ?? null;
              return (
                <li key={r.id} className="grid grid-cols-1 gap-2 py-2.5 md:grid-cols-[minmax(0,1fr)_5rem_9rem_10rem_11rem] md:items-center">
                  <div className="min-w-0">
                    <Link href={`/opportunities/${r.id}`} className="block truncate font-body text-[14px] text-text hover:underline">
                      {r.title}
                    </Link>
                    <p className="truncate font-mono text-[11px] text-muted">{[r.agency, r.solicitationNumber, r.owner ?? "unassigned"].filter(Boolean).join(" · ")}</p>
                  </div>
                  <span className={`font-mono text-[11px] ${days !== null && days < 5 ? "text-red" : "text-muted"}`}>{days === null ? "no due date" : days < 0 ? "past due" : `${days}d left`}</span>
                  {analysed ? (
                    <Link href={`/opportunities/${r.id}/analysis`} className="font-mono text-[11px] text-text hover:underline">
                      PWin {s?.analysisPwin ?? r.pWin}%{call ? ` · ${call}` : ""}
                    </Link>
                  ) : (
                    <Link href={`/opportunities/${r.id}/analysis`} className="aur-btn aur-btn-ghost justify-self-start">
                      Analyze
                    </Link>
                  )}
                  {matrixBuilt ? (
                    <Link href={`/opportunities/${r.id}/capability`} className="font-mono text-[11px] text-text hover:underline">
                      {s?.coverage == null ? `${s?.answered ?? 0} of ${s?.questions ?? 0} answered` : `Coverage ${Math.round(s.coverage * 100)}%`}
                    </Link>
                  ) : (
                    <Link href={`/opportunities/${r.id}/capability`} className="aur-btn aur-btn-ghost justify-self-start whitespace-nowrap">
                      Capability Matrix
                    </Link>
                  )}
                  {decision ? (
                    <Link href={`/opportunities/${r.id}/evaluation#decision`} className={`font-mono text-[11px] uppercase tracking-widest hover:underline ${DECISION_TONE[decision.decision]}`}>
                      {DECISION_LABELS[decision.decision]}
                    </Link>
                  ) : (
                    <Link href={`/opportunities/${r.id}/evaluation#decision`} className={`aur-btn justify-self-start whitespace-nowrap ${analysed && matrixBuilt ? "aur-btn-primary" : "aur-btn-ghost"}`} title={analysed && matrixBuilt ? undefined : "Analyze it and build the capability matrix first for a well-informed call"}>
                      {analysed && matrixBuilt ? "Decide" : !analysed && !matrixBuilt ? "Needs both reports" : !analysed ? "Needs analysis" : "Needs matrix"}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <Panel
        title="Documents not yet on an opportunity"
        eyebrow={`${docs.length} ${docs.length === 1 ? "document" : "documents"}`}
        actions={
          <Link href="/solicitations/new" className="aur-btn aur-btn-ghost">
            + Upload solicitation
          </Link>
        }
      >
        {docs.length === 0 ? (
          <p className="font-body text-[13px] leading-[1.5] text-muted">Every uploaded solicitation is on an opportunity. A document on an opportunity opens from that opportunity.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-layer/10">
            {docs.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <Link href={`/solicitations/${d.id}`} className="min-w-0 flex-1 truncate font-body text-[14px] text-text hover:underline">
                  {d.title || d.fileName || "Untitled"}
                </Link>
                <span className="font-mono text-[11px] text-muted">{[d.agency, d.number, d.due ? `due ${d.due.toISOString().slice(0, 10)}` : "", d.status === "parsed" ? "" : d.status].filter(Boolean).join(" · ")}</span>
                <Link href={`/pipeline/identify?tab=create&from=${d.id}&wait=0`} className="aur-btn aur-btn-ghost">
                  Create opportunity from it
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
