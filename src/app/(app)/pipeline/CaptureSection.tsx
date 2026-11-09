import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { requireCurrentOrg } from "@/lib/auth-helpers";
import { captureNextStep, emptyPartnerCounts, NEXT_STEP_LABELS } from "@/lib/capture-logic";
import { partnerSummaries } from "@/lib/capture-store";
import type { PartnerCounts } from "@/lib/capture-logic";
import { DECISION_LABELS, daysLeft } from "@/lib/opportunity-decision";
import { latestDecisions, type DecisionView } from "@/lib/opportunity-decision-store";
import { safeQuery } from "@/lib/schema-resilience";
import type { StageListRow } from "./StageList";
import { SourceLink } from "@/components/opportunities/SourceLink";

const DECISION_TONE = { go: "text-green", no_go: "text-red", partner: "text-indigo", plan: "text-cobalt" } as const;

/**
 * BL-NAV-LIFECYCLE phase 3a (FORGE II footnote 6, C-1) — the Capture page:
 * every opportunity decided GO or PARTNER (stage Qualified), one row
 * each, with its partners and the next step: find partners, choose one,
 * or move to Plan.
 */
export async function CaptureSection({ rows }: { rows: StageListRow[] }) {
  const { organizationId } = await requireCurrentOrg();
  const ids = rows.map((r) => r.id);
  const [decisions, partners] = await Promise.all([
    safeQuery<Map<string, DecisionView>>(() => latestDecisions(organizationId, ids), new Map(), { tag: "pipeline.capture.decisions" }),
    safeQuery<Map<string, { counts: PartnerCounts; chosen: string[] }>>(() => partnerSummaries(organizationId, ids), new Map(), { tag: "pipeline.capture.partners" }),
  ]);
  return (
    <Panel title="In Capture" eyebrow={`${rows.length} ${rows.length === 1 ? "opportunity" : "opportunities"}`}>
      {rows.length === 0 ? (
        <p className="font-body text-[13px] leading-[1.5] text-muted">Nothing is in Capture. A GO or PARTNER decision on Evaluate brings an opportunity here.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-layer/10">
          {rows.map((r) => {
            const decision = decisions.get(r.id)?.decision ?? null;
            const p = partners.get(r.id) ?? { counts: emptyPartnerCounts(), chosen: [] };
            const step = captureNextStep({ decision, counts: p.counts });
            const days = daysLeft(r.responseDueDate);
            const considered = p.counts.candidate + p.counts.invited + p.counts.answered + p.counts.chosen;
            return (
              <li key={r.id} className="grid grid-cols-1 gap-2 py-2.5 md:grid-cols-[minmax(0,1fr)_6rem_5rem_12rem_10rem] md:items-center">
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
                <span className={`font-mono text-[11px] uppercase tracking-widest ${decision ? DECISION_TONE[decision] : "text-muted"}`}>{decision ? DECISION_LABELS[decision] : "no decision"}</span>
                <span className={`font-mono text-[11px] ${days !== null && days < 5 ? "text-red" : "text-muted"}`}>{days === null ? "no due date" : days < 0 ? "past due" : `${days}d left`}</span>
                <span className="font-mono text-[11px] text-muted">
                  {p.chosen.length > 0 ? `Partner: ${p.chosen.join(", ")}` : considered > 0 ? `${considered} partner${considered === 1 ? "" : "s"} considered` : decision === "partner" ? "No partner yet" : "No partner needed"}
                </span>
                <Link href={`/opportunities/${r.id}/partners`} className={`aur-btn justify-self-start whitespace-nowrap ${step === "move_to_plan" ? "aur-btn-primary" : "aur-btn-ghost"}`}>
                  {NEXT_STEP_LABELS[step]}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
