import Link from "next/link";
import { Panel } from "@/components/ui/Panel";
import { requireCurrentOrg } from "@/lib/auth-helpers";
import { replyTypeLabel } from "@/lib/correspondence-logic";
import { SUBMISSION_METHOD_LABELS, type DeliveredSummary } from "@/lib/deliver-logic";
import { deliveredSummaries, readyToDeliver, type ReadyRow } from "@/lib/deliver-pipeline";
import { daysLeft } from "@/lib/opportunity-decision";
import { safeQuery } from "@/lib/schema-resilience";
import type { StageListRow } from "./StageList";

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
const STAGE_LABELS: Record<ReadyRow["proposalStage"], string> = { gold_team: "Gold", white_gloves: "White Gloves" };

/**
 * BL-NAV-LIFECYCLE 6d-2 (design §2.6) — Pipeline → Deliver's two lists.
 * Ready to deliver: opportunities still in Develop whose proposal is at
 * Gold or White Gloves, with the sign-off line and the due date.
 * Delivered: the submitted ones, with how, when and to whom, the newest
 * reply and how many replies came since the team's last message.
 */
export async function DeliverSection({ rows }: { rows: StageListRow[] }) {
  const { organizationId } = await requireCurrentOrg();
  const [ready, summaries] = await Promise.all([
    safeQuery<ReadyRow[]>(() => readyToDeliver(organizationId), [], { tag: "pipeline.deliver.ready" }),
    safeQuery<Map<string, DeliveredSummary>>(() => deliveredSummaries(organizationId, rows.map((r) => r.id)), new Map(), { tag: "pipeline.deliver.delivered" }),
  ]);
  const count = (n: number) => `${n} ${n === 1 ? "opportunity" : "opportunities"}`;
  return (
    <>
      <Panel title="Ready to deliver" eyebrow={count(ready.length)}>
        {ready.length === 0 ? (
          <p className="font-body text-[13px] leading-[1.5] text-muted">Nothing is ready yet. An opportunity in Develop appears here once its proposal reaches Gold or White Gloves.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-layer/10">
            {ready.map((r) => {
              const days = daysLeft(r.responseDueDate);
              return (
                <li key={r.id} className="grid grid-cols-1 gap-2 py-2.5 md:grid-cols-[minmax(0,1fr)_9rem_22rem_9rem] md:items-center">
                  <Heading id={r.id} title={r.title} line={[r.agency, r.solicitationNumber, r.owner ?? "unassigned"]} />
                  <span className={`font-mono text-[11px] ${days !== null && days < 5 ? "text-red" : "text-muted"}`}>
                    {r.responseDueDate ? `Due ${day(r.responseDueDate)}` : "no due date"}
                    {days === null ? "" : days < 0 ? " · past due" : ` · ${days}d left`}
                  </span>
                  <span className="font-mono text-[11px] text-muted">At {STAGE_LABELS[r.proposalStage]} · {r.signoffLine}</span>
                  <OpenDeliver id={r.id} />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <Panel title="Delivered" eyebrow={count(rows.length)}>
        {rows.length === 0 ? (
          <p className="font-body text-[13px] leading-[1.5] text-muted">Nothing has been submitted yet. Send from FORGE or Record submission on an opportunity&apos;s Deliver tab brings it here.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-layer/10">
            {rows.map((r) => {
              const s = summaries.get(r.id);
              return (
                <li key={r.id} className="grid grid-cols-1 gap-2 py-2.5 md:grid-cols-[minmax(0,1fr)_22rem_16rem_9rem] md:items-center">
                  <Heading id={r.id} title={r.title} line={[r.agency, r.solicitationNumber, r.owner ?? "unassigned"]} />
                  <span className="min-w-0 truncate font-mono text-[11px] text-muted">
                    {s?.submission
                      ? [SUBMISSION_METHOD_LABELS[s.submission.method], day(s.submission.sentAt), s.submission.recipients.length ? `to ${s.submission.recipients.join(", ")}` : ""].filter(Boolean).join(" · ")
                      : "No submission on record"}
                  </span>
                  <span className="font-mono text-[11px] text-muted">
                    {s?.newestReply ? `${s.newestReply.type ? replyTypeLabel(s.newestReply.type) : "Being read"} · ${day(s.newestReply.receivedAt)}` : "No replies"}
                    {s && s.repliesSinceLastSent > 0 ? (
                      <span className="text-cobalt"> · {s.repliesSinceLastSent} since your last message</span>
                    ) : null}
                  </span>
                  <OpenDeliver id={r.id} />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}

function Heading({ id, title, line }: { id: string; title: string; line: (string | null)[] }) {
  return (
    <div className="min-w-0">
      <Link href={`/opportunities/${id}`} className="block truncate font-body text-[14px] text-text hover:underline">
        {title}
      </Link>
      <p className="truncate font-mono text-[11px] text-muted">{line.filter(Boolean).join(" · ")}</p>
    </div>
  );
}

function OpenDeliver({ id }: { id: string }) {
  return (
    <Link href={`/opportunities/${id}/deliver`} className="aur-btn aur-btn-primary justify-self-start whitespace-nowrap">
      Open Deliver
    </Link>
  );
}
