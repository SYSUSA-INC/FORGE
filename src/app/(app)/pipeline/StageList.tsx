import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import type { OpportunityStage } from "@/db/schema";
import { STAGE_LABELS } from "@/lib/opportunity-types";

export type StageListRow = {
  id: string;
  title: string;
  agency: string;
  stage: OpportunityStage;
  solicitationNumber: string;
  responseDueDate: string | null;
  pWin: number;
  owner: string | null;
};

/**
 * BL-NAV-LIFECYCLE — the worklist of a stage page: the opportunities at
 * the pipeline stages the lifecycle stage covers, newest due first.
 */
export function StageList({ rows, title, empty }: { rows: StageListRow[]; title: string; empty: string }) {
  return (
    <Panel title={title} eyebrow={`${rows.length} ${rows.length === 1 ? "opportunity" : "opportunities"}`}>
      {rows.length === 0 ? (
        <p className="font-body text-[13px] leading-[1.5] text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-layer/10">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
              <Link href={`/opportunities/${r.id}`} className="min-w-0 flex-1 truncate font-body text-[14px] text-text hover:underline">
                {r.title}
              </Link>
              <span className="font-mono text-[11px] text-muted">{r.agency || "—"}</span>
              <span className="rounded bg-cobalt/15 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-cobalt">{STAGE_LABELS[r.stage]}</span>
              <span className="font-mono text-[11px] text-muted">{r.responseDueDate ? `due ${r.responseDueDate.slice(0, 10)}` : "no due date"}</span>
              <span className="font-mono text-[11px] text-muted">PWin {r.pWin}%</span>
              <span className="font-mono text-[11px] text-muted">{r.owner ?? "unassigned"}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
