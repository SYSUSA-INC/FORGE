import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { SourceLink } from "@/components/opportunities/SourceLink";
import { requireCurrentOrg } from "@/lib/auth-helpers";
import { daysLeft } from "@/lib/opportunity-decision";
import { PLAN_NEXT_STEP_LABELS, planNextStep, planState, planStateLine, type PlanState } from "@/lib/plan-logic";
import { planSummaries } from "@/lib/plan-store";
import { safeQuery } from "@/lib/schema-resilience";
import type { StageListRow } from "./StageList";

/**
 * BL-NAV-LIFECYCLE phase 4a (FORGE II footnote 7, P-1 to P-3) — the Plan
 * page: every opportunity that passed Capture (stage Captured), one row
 * each, with days left, the plan's state and the next step.
 */
export async function PlanSection({ rows }: { rows: StageListRow[] }) {
  const { organizationId } = await requireCurrentOrg();
  const ids = rows.map((r) => r.id);
  const plans = await safeQuery<Map<string, PlanState>>(() => planSummaries(organizationId, ids), new Map(), { tag: "pipeline.plan.summaries" });
  return (
    <Panel title="In Plan" eyebrow={`${rows.length} ${rows.length === 1 ? "opportunity" : "opportunities"}`}>
      {rows.length === 0 ? (
        <p className="font-body text-[13px] leading-[1.5] text-muted">Nothing is in Plan. Move to Plan on Capture brings an opportunity here.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-layer/10">
          {rows.map((r) => {
            const state = plans.get(r.id) ?? planState([]);
            const step = planNextStep(state);
            const days = daysLeft(r.responseDueDate);
            return (
              <li key={r.id} className="grid grid-cols-1 gap-2 py-2.5 md:grid-cols-[minmax(0,1fr)_5rem_18rem_11rem] md:items-center">
                <div className="min-w-0">
                  <Link href={`/opportunities/${r.id}`} className="block truncate font-body text-[14px] text-text hover:underline">
                    {r.title}
                  </Link>
                  <p className="flex min-w-0 items-baseline gap-1 font-mono text-[11px] text-muted">
                    <span className="truncate">{[r.agency, r.solicitationNumber, r.owner ?? "unassigned"].filter(Boolean).join(" · ")}</span>
                    {r.sourceUrl ? <span aria-hidden="true">·</span> : null}
                    <SourceLink source={r.source} url={r.sourceUrl} className="shrink-0" />
                  </p>
                </div>
                <span className={`font-mono text-[11px] ${days !== null && days < 5 ? "text-red" : "text-muted"}`}>{days === null ? "no due date" : days < 0 ? "past due" : `${days}d left`}</span>
                <span className="font-mono text-[11px] text-muted">{planStateLine(state)}</span>
                <Link href={`/opportunities/${r.id}/plan`} className="aur-btn aur-btn-primary justify-self-start whitespace-nowrap">
                  {PLAN_NEXT_STEP_LABELS[step]}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
