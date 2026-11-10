import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { SourceLink } from "@/components/opportunities/SourceLink";
import { requireCurrentOrg } from "@/lib/auth-helpers";
import { daysLeft } from "@/lib/opportunity-decision";
import { DEVELOP_NEXT_STEP_LABELS, developNextStep, developStateLine, NO_READINESS, type DevelopNextStep, type DevelopState } from "@/lib/develop-logic";
import { developSummaries } from "@/lib/develop-store";
import { safeQuery } from "@/lib/schema-resilience";
import type { StageListRow } from "./StageList";

type Summary = { state: DevelopState; step: DevelopNextStep; line: string };

/**
 * BL-NAV-LIFECYCLE 5a (FORGE II D-1, D-3) — Pipeline → Develop: every
 * opportunity at Developed, one row each, with days left, the draft's
 * state line and the next step.
 */
export async function DevelopSection({ rows }: { rows: StageListRow[] }) {
  const { organizationId } = await requireCurrentOrg();
  const summaries = await safeQuery<Map<string, Summary>>(() => developSummaries(organizationId, rows.map((r) => r.id)), new Map(), { tag: "pipeline.develop.summaries" });
  const none: DevelopState = { hasProposal: false, readiness: NO_READINESS, nextReview: null };
  return (
    <Panel title="In Develop" eyebrow={`${rows.length} ${rows.length === 1 ? "opportunity" : "opportunities"}`}>
      {rows.length === 0 ? (
        <p className="font-body text-[13px] leading-[1.5] text-muted">Nothing is in Develop. Move to Develop on the Plan tab brings an opportunity here.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-layer/10">
          {rows.map((r) => {
            const s = summaries.get(r.id) ?? { state: none, step: developNextStep(none), line: developStateLine(none) };
            const days = daysLeft(r.responseDueDate);
            return (
              <li key={r.id} className="grid grid-cols-1 gap-2 py-2.5 md:grid-cols-[minmax(0,1fr)_5rem_22rem_11rem] md:items-center">
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
                <span className="font-mono text-[11px] text-muted">{s.line}</span>
                <Link href={`/opportunities/${r.id}/develop`} className="aur-btn aur-btn-primary justify-self-start whitespace-nowrap">
                  {DEVELOP_NEXT_STEP_LABELS[s.step]}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
